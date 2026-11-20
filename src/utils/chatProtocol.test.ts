import { describe, expect, it } from 'vitest';
import { describeToolInput, interpretChatLine } from './chatProtocol';

const line = (obj: unknown) => JSON.stringify(obj);

describe('interpretChatLine', () => {
  it('ignores lines that are not JSON objects or are of no interest', () => {
    expect(interpretChatLine('warning: something')).toEqual([]);
    expect(interpretChatLine('[1,2]')).toEqual([]);
    expect(interpretChatLine(line({ type: 'rate_limit_event', session_id: 's' }))).toEqual([]);
    expect(interpretChatLine(line({ type: 'system', subtype: 'status' }))).toEqual([]);
  });

  it('picks up the session id when the session starts', () => {
    expect(interpretChatLine(line({ type: 'system', subtype: 'init', session_id: 'abc' }))).toEqual([
      { type: 'session', id: 'abc' },
    ]);
  });

  it('streams text deltas and resets the stream when a new message starts', () => {
    expect(
      interpretChatLine(line({ type: 'stream_event', event: { type: 'message_start' } })),
    ).toEqual([{ type: 'streamReset' }]);
    expect(
      interpretChatLine(
        line({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
        }),
      ),
    ).toEqual([{ type: 'streamDelta', text: 'Hel' }]);
    // Thinking is not shown.
    expect(
      interpretChatLine(
        line({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } },
        }),
      ),
    ).toEqual([]);
  });

  it('turns a finished assistant message into items', () => {
    const updates = interpretChatLine(
      line({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: 'Смотрю файл.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/p/app/Main.kt' } },
          ],
        },
      }),
    );
    expect(updates).toEqual([
      { type: 'streamReset' },
      { type: 'item', item: { kind: 'assistant', text: 'Смотрю файл.' } },
      { type: 'item', item: { kind: 'tool', tool: 'Read', text: '/p/app/Main.kt' } },
    ]);
  });

  it('skips the internal messages of sub-agents', () => {
    expect(
      interpretChatLine(
        line({
          type: 'assistant',
          parent_tool_use_id: 'toolu_1',
          message: { content: [{ type: 'text', text: 'internal' }] },
        }),
      ),
    ).toEqual([]);
  });

  it('reports the result with cost', () => {
    expect(
      interpretChatLine(
        line({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'ok',
          session_id: 's1',
          total_cost_usd: 0.0038,
          permission_denials: [],
        }),
      ),
    ).toEqual([
      { type: 'session', id: 's1' },
      { type: 'done', isError: false, costUsd: 0.0038 },
    ]);
  });

  it('explains refused tools and surfaces errors', () => {
    const updates = interpretChatLine(
      line({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: '',
        permission_denials: [{ tool_name: 'Edit' }, { tool_name: 'Edit' }, { tool_name: 'Bash' }],
      }),
    );
    expect(updates[0]).toMatchObject({ type: 'item', item: { kind: 'info' } });
    expect((updates[0] as { item: { text: string } }).item.text).toContain('Edit, Bash');
    expect(updates[1]).toEqual({
      type: 'item',
      item: { kind: 'error', text: 'Запрос завершился с ошибкой (error_during_execution)' },
    });
    expect(updates[2]).toEqual({ type: 'done', isError: true, costUsd: null });
  });
});

describe('describeToolInput', () => {
  it('prefers the path or command and keeps it to one short line', () => {
    expect(describeToolInput({ command: 'git  status\n--short' })).toBe('git status --short');
    expect(describeToolInput({ pattern: 'TODO', path: '/src' })).toBe('/src');
    expect(describeToolInput({ other: 1 })).toBe('');
    expect(describeToolInput('x')).toBe('');
    expect(describeToolInput({ command: 'a'.repeat(500) })).toHaveLength(160);
  });
});
