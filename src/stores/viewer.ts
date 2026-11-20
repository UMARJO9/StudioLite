import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, markRaw, ref } from 'vue';
import { api, type FileEntry } from '../api';
import { errorMessage } from '../utils/errors';
import { highlightToLines } from '../utils/highlight';
import { useProjectStore } from './project';

export const BUILD_TAB = 'build';

export interface FileTab {
  path: string;
  name: string;
  /** A preview tab is reused by the next single click; double click or pinning keeps it. */
  preview: boolean;
  loading: boolean;
  error: string | null;
  /** One highlighted HTML string per line. Not reactive: can be tens of thousands of items. */
  lines: string[];
  binary: boolean;
  truncated: boolean;
  size: number;
}

/** Read-only file viewer: tabs next to the build console. */
export const useViewerStore = defineStore('viewer', () => {
  const project = useProjectStore();

  const tabs = ref<FileTab[]>([]);
  /** `BUILD_TAB` or the path of an open file. */
  const active = ref<string>(BUILD_TAB);

  const activeFile = computed(() => tabs.value.find((t) => t.path === active.value) ?? null);

  async function load(path: string): Promise<void> {
    const root = project.path;
    const find = () => tabs.value.find((t) => t.path === path);
    const tab = find();
    if (!root || !tab) return;
    try {
      const file = await api.readFile(root, path);
      const lines = file.binary ? [] : await highlightToLines(tab.name, file.content);
      const current = find();
      if (!current) return; // closed while loading
      current.lines = markRaw(lines);
      current.binary = file.binary;
      current.truncated = file.truncated;
      current.size = file.size;
      current.error = null;
    } catch (e) {
      const current = find();
      if (current) {
        current.error = errorMessage(e);
        current.lines = markRaw([]);
      }
    } finally {
      const current = find();
      if (current) current.loading = false;
    }
  }

  /** Opens a file. `pin: false` (single click) shows it in the reusable preview tab. */
  function open(entry: FileEntry, opts: { pin: boolean }): void {
    if (entry.isDir) return;
    const existing = tabs.value.find((t) => t.path === entry.path);
    if (existing) {
      if (opts.pin) existing.preview = false;
      active.value = existing.path;
      return;
    }
    const tab: FileTab = {
      path: entry.path,
      name: entry.name,
      preview: !opts.pin,
      loading: true,
      error: null,
      lines: markRaw([]),
      binary: false,
      truncated: false,
      size: 0,
    };
    const previewIndex = opts.pin ? -1 : tabs.value.findIndex((t) => t.preview);
    if (previewIndex !== -1) tabs.value.splice(previewIndex, 1, tab);
    else tabs.value.push(tab);
    active.value = tab.path;
    void load(tab.path);
  }

  function pin(path: string): void {
    const tab = tabs.value.find((t) => t.path === path);
    if (tab) tab.preview = false;
  }

  function close(path: string): void {
    const index = tabs.value.findIndex((t) => t.path === path);
    if (index === -1) return;
    tabs.value.splice(index, 1);
    if (active.value === path) {
      const neighbour = tabs.value[index] ?? tabs.value[index - 1];
      active.value = neighbour ? neighbour.path : BUILD_TAB;
    }
  }

  /** Re-reads the file on screen: it may have been edited in another program. */
  async function reloadActive(): Promise<void> {
    if (activeFile.value) await load(activeFile.value.path);
  }

  function reset(): void {
    tabs.value = [];
    active.value = BUILD_TAB;
  }

  function showBuild(): void {
    active.value = BUILD_TAB;
  }

  return { tabs, active, activeFile, open, pin, close, reloadActive, reset, showBuild };
});

// Without this, editing the store during development leaves the old instance in use.
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useViewerStore, import.meta.hot));
