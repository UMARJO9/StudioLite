import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { api, type Commit, type GitStatusKind } from '../api';
import { buildStatusIndex, emptyStatusIndex, lookupStatus, type StatusIndex } from '../utils/gitStatus';
import { useProjectStore } from './project';
import { useToastsStore } from './toasts';

export const LOG_PAGE_SIZE = 300;

export const useGitStore = defineStore('git', () => {
  const project = useProjectStore();
  const toasts = useToastsStore();

  const branch = ref<string | null>(null);
  const statusIndex = shallowRef<StatusIndex>(emptyStatusIndex());

  const commits = shallowRef<Commit[]>([]);
  const hasMore = ref(false);
  const logLoading = ref(false);

  function reset() {
    branch.value = null;
    statusIndex.value = emptyStatusIndex();
    commits.value = [];
    hasMore.value = false;
  }

  /** The repo of the currently open project, or null if there is nothing to query. */
  function repo(): { path: string; root: string } | null {
    const info = project.info;
    return info?.isGitRepo ? { path: info.path, root: info.gitRoot ?? info.path } : null;
  }

  async function refreshStatus(): Promise<void> {
    const target = repo();
    if (!target) return;
    try {
      const [currentBranch, entries] = await Promise.all([
        api.gitBranch(target.path),
        api.gitStatus(target.path),
      ]);
      if (project.path !== target.path) return; // project switched meanwhile
      branch.value = currentBranch;
      statusIndex.value = buildStatusIndex(entries, target.root, project.sep);
    } catch (e) {
      toasts.error(e, 'Git-статус');
    }
  }

  /** Reloads as many commits as are currently shown (at least one page). */
  async function refreshLog(): Promise<void> {
    const target = repo();
    if (!target || logLoading.value) return;
    const limit = Math.max(LOG_PAGE_SIZE, commits.value.length);
    logLoading.value = true;
    try {
      const loaded = await api.gitLog(target.path, 0, limit);
      if (project.path !== target.path) return;
      commits.value = loaded;
      hasMore.value = loaded.length === limit;
    } catch (e) {
      toasts.error(e, 'Git-граф');
    } finally {
      logLoading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    const target = repo();
    if (!target || logLoading.value || !hasMore.value) return;
    logLoading.value = true;
    try {
      const page = await api.gitLog(target.path, commits.value.length, LOG_PAGE_SIZE);
      if (project.path !== target.path) return;
      // Refs may have moved between requests; never show the same commit twice.
      const known = new Set(commits.value.map((c) => c.hash));
      commits.value = [...commits.value, ...page.filter((c) => !known.has(c.hash))];
      hasMore.value = page.length === LOG_PAGE_SIZE;
    } catch (e) {
      toasts.error(e, 'Git-граф');
    } finally {
      logLoading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshStatus(), refreshLog()]);
  }

  function statusOf(path: string): GitStatusKind | null {
    return lookupStatus(statusIndex.value, path, project.sep);
  }

  return {
    branch,
    statusIndex,
    commits,
    hasMore,
    logLoading,
    reset,
    refresh,
    refreshStatus,
    refreshLog,
    loadMore,
    statusOf,
  };
});

// Without this, editing the store during development leaves the old instance in use.
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useGitStore, import.meta.hot));
