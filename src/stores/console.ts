import { acceptHMRUpdate, defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { OutLine } from '../api';
import { classifyLine, type ConsoleLevel } from '../utils/consoleLevel';

export const MAX_CONSOLE_LINES = 10_000;
/** A single minified line can be megabytes long; rendering it would freeze the view. */
const MAX_LINE_LENGTH = 4000;

export interface ConsoleLine {
  id: number;
  text: string;
  level: ConsoleLevel;
}

export const useConsoleStore = defineStore('console', () => {
  // Replaced wholesale on every batch: no deep reactivity over thousands of lines.
  const lines = shallowRef<ConsoleLine[]>([]);
  let nextId = 1;

  function push(items: ConsoleLine[]) {
    const next = lines.value.concat(items);
    lines.value =
      next.length > MAX_CONSOLE_LINES ? next.slice(next.length - MAX_CONSOLE_LINES) : next;
  }

  function append(batch: OutLine[]) {
    push(
      batch.map((line) => ({
        id: nextId++,
        text:
          line.text.length > MAX_LINE_LENGTH
            ? line.text.slice(0, MAX_LINE_LENGTH) + ' …'
            : line.text,
        level: classifyLine(line.stream, line.text),
      })),
    );
  }

  /** A line from StudioLite itself with an explicit level. */
  function note(text: string, level: ConsoleLevel = 'info') {
    push([{ id: nextId++, text, level }]);
  }

  function clear() {
    lines.value = [];
  }

  return { lines, append, note, clear };
});

// Without this, editing the store during development leaves the old instance in use.
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useConsoleStore, import.meta.hot));
