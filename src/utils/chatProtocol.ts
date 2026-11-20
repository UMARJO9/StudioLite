// Turns the JSON lines printed by the chat CLI (its "stream-json" output) into updates
// for the chat view. Pure: no stores, no DOM.

export type ChatItemKind = 'user' | 'assistant' | 'tool' | 'info' | 'error';

export interface ChatItemData {
  kind: ChatItemKind;
  text: string;
  /** Tool name, for `kind: 'tool'`. */
  tool?: string;
  /** Small previews (data URLs) of the pictures sent with a user message. */
  images?: string[];
}

export type ChatUpdate =
  | { type: 'session'; id: string }
  /** A new answer started: drop the text streamed so far. */
  | { type: 'streamReset' }
  | { type: 'streamDelta'; text: string }
  | { type: 'item'; item: ChatItemData }
  | { type: 'done'; isError: boolean };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function shorten(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

/** A one-line description of what a tool call is doing, from its input. */
export function describeToolInput(input: unknown): string {
  if (!isObject(input)) return '';
  for (const key of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value) return shorten(value);
  }
  return '';
}

export function interpretChatLine(line: string): ChatUpdate[] {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObject(data)) return [];

  const updates: ChatUpdate[] = [];
  const sessionId = str(data.session_id);
  // Messages produced inside a sub-agent are its internal work, not part of the answer.
  const fromSubAgent = typeof data.parent_tool_use_id === 'string';

  switch (data.type) {
    case 'system':
      if (data.subtype === 'init' && sessionId) updates.push({ type: 'session', id: sessionId });
      break;

    case 'stream_event': {
      if (fromSubAgent || !isObject(data.event)) break;
      const event = data.event;
      if (event.type === 'message_start') {
        updates.push({ type: 'streamReset' });
      } else if (event.type === 'content_block_delta' && isObject(event.delta)) {
        if (event.delta.type === 'text_delta') {
          updates.push({ type: 'streamDelta', text: str(event.delta.text) });
        }
      }
      break;
    }

    case 'assistant': {
      if (fromSubAgent || !isObject(data.message)) break;
      const content = Array.isArray(data.message.content) ? data.message.content : [];
      for (const block of content) {
        if (!isObject(block)) continue;
        if (block.type === 'text' && str(block.text).trim()) {
          // The complete text replaces what was streamed for it.
          updates.push({ type: 'streamReset' });
          updates.push({ type: 'item', item: { kind: 'assistant', text: str(block.text) } });
        } else if (block.type === 'tool_use') {
          updates.push({
            type: 'item',
            item: { kind: 'tool', tool: str(block.name), text: describeToolInput(block.input) },
          });
        }
      }
      break;
    }

    case 'result': {
      if (sessionId) updates.push({ type: 'session', id: sessionId });
      const denials = Array.isArray(data.permission_denials) ? data.permission_denials : [];
      const denied = [
        ...new Set(denials.map((d) => (isObject(d) ? str(d.tool_name) : '')).filter(Boolean)),
      ];
      if (denied.length) {
        updates.push({
          type: 'item',
          item: {
            kind: 'info',
            text: `Не выполнено из-за режима доступа: ${denied.join(', ')}. Чтобы разрешить правку файлов, переключите режим чата.`,
          },
        });
      }
      const isError = data.is_error === true;
      if (isError) {
        const text = str(data.result) || `Запрос завершился с ошибкой (${str(data.subtype) || '?'})`;
        updates.push({ type: 'item', item: { kind: 'error', text } });
      }
      updates.push({ type: 'done', isError });
      break;
    }
  }
  return updates;
}
