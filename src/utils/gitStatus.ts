import type { GitFileStatus, GitStatusKind } from '../api/types';
import { parentOf } from './paths';

export interface StatusIndex {
  /** Exact paths reported by git. */
  files: Map<string, GitStatusKind>;
  /** Aggregated status of every directory that contains changes. */
  dirs: Map<string, GitStatusKind>;
  /** git reports a wholly untracked directory as one entry; everything inside is untracked. */
  untrackedDirs: string[];
}

export function emptyStatusIndex(): StatusIndex {
  return { files: new Map(), dirs: new Map(), untrackedDirs: [] };
}

function mergeDirStatus(
  existing: GitStatusKind | undefined,
  incoming: GitStatusKind,
): GitStatusKind {
  // A folder is green only if everything changed inside is new; a deletion makes it "modified".
  const normalized: GitStatusKind =
    incoming === 'untracked' ? 'added' : incoming === 'deleted' ? 'modified' : incoming;
  if (existing === 'conflict' || normalized === 'conflict') return 'conflict';
  if (existing === undefined || existing === normalized) return normalized;
  return 'modified';
}

export function buildStatusIndex(entries: GitFileStatus[], root: string, sep: string): StatusIndex {
  const index = emptyStatusIndex();
  for (const entry of entries) {
    index.files.set(entry.path, entry.status);
    if (entry.isDir && entry.status === 'untracked') index.untrackedDirs.push(entry.path);

    let dir = parentOf(entry.path, sep);
    while (dir !== null && dir.length > root.length && dir.startsWith(root)) {
      index.dirs.set(dir, mergeDirStatus(index.dirs.get(dir), entry.status));
      dir = parentOf(dir, sep);
    }
  }
  return index;
}

export function lookupStatus(index: StatusIndex, path: string, sep: string): GitStatusKind | null {
  const direct = index.files.get(path) ?? index.dirs.get(path);
  if (direct) return direct;
  for (const dir of index.untrackedDirs) {
    if (path.startsWith(dir + sep)) return 'untracked';
  }
  return null;
}
