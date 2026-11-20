export function separatorOf(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function parentOf(path: string, sep: string): string | null {
  const i = path.lastIndexOf(sep);
  return i > 0 ? path.slice(0, i) : null;
}

/** `/repo/app/src` relative to `/repo` → `app/src`. */
export function relativeTo(path: string, root: string, sep: string): string {
  if (path === root) return '';
  return path.startsWith(root + sep) ? path.slice(root.length + 1) : path;
}
