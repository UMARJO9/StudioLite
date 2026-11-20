import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, type FileEntry } from '../api';
import { useProjectStore } from './project';
import { useToastsStore } from './toasts';

export interface TreeRow {
  entry: FileEntry;
  depth: number;
  expanded: boolean;
}

export const useTreeStore = defineStore('tree', () => {
  const project = useProjectStore();
  const toasts = useToastsStore();

  /** Loaded directory listings, keyed by directory path. A folder is read when first expanded. */
  const children = ref(new Map<string, FileEntry[]>());
  const expanded = ref(new Set<string>());
  const selected = ref<string | null>(null);
  const loading = ref(false);

  /** The tree flattened to what is currently visible, ready for a virtual list. */
  const rows = computed<TreeRow[]>(() => {
    const result: TreeRow[] = [];
    const root = project.path;
    if (!root) return result;
    const walk = (dir: string, depth: number) => {
      for (const entry of children.value.get(dir) ?? []) {
        const isExpanded = entry.isDir && expanded.value.has(entry.path);
        result.push({ entry, depth, expanded: isExpanded });
        if (isExpanded) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return result;
  });

  function reset() {
    children.value = new Map();
    expanded.value = new Set();
    selected.value = null;
  }

  async function load(dir: string): Promise<boolean> {
    const root = project.path;
    if (!root) return false;
    try {
      const entries = await api.readDir(root, dir);
      if (project.path !== root) return false;
      children.value.set(dir, entries);
      return true;
    } catch (e) {
      // The folder may have been removed on disk; drop it instead of showing stale content.
      children.value.delete(dir);
      expanded.value.delete(dir);
      if (dir === root) toasts.error(e, 'Дерево файлов');
      return false;
    }
  }

  async function toggle(entry: FileEntry): Promise<void> {
    if (!entry.isDir) return;
    if (expanded.value.has(entry.path)) {
      expanded.value.delete(entry.path);
      return;
    }
    expanded.value.add(entry.path);
    if (!children.value.has(entry.path)) {
      const ok = await load(entry.path);
      if (!ok) toasts.warning(`Не удалось прочитать папку ${entry.name}`);
    }
  }

  /** Re-reads the root and every expanded folder. */
  async function refresh(): Promise<void> {
    const root = project.path;
    if (!root || loading.value) return;
    loading.value = true;
    try {
      await Promise.all([root, ...expanded.value].map((dir) => load(dir)));
    } finally {
      loading.value = false;
    }
  }

  function collapseAll() {
    expanded.value = new Set();
  }

  return { rows, selected, loading, expanded, reset, toggle, refresh, collapseAll };
});
