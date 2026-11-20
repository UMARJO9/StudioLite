export type RefKind = 'head' | 'branch' | 'remote' | 'tag' | 'other';

export interface RefBadge {
  kind: RefKind;
  name: string;
  /** True for the branch HEAD points at. */
  current: boolean;
}

function classify(fullName: string, current: boolean): RefBadge | null {
  if (fullName.startsWith('refs/heads/')) {
    return { kind: 'branch', name: fullName.slice('refs/heads/'.length), current };
  }
  if (fullName.startsWith('refs/remotes/')) {
    const name = fullName.slice('refs/remotes/'.length);
    // origin/HEAD only says which remote branch is the default; it's noise in the graph.
    return name.endsWith('/HEAD') ? null : { kind: 'remote', name, current: false };
  }
  if (fullName.startsWith('refs/tags/')) {
    return { kind: 'tag', name: fullName.slice('refs/tags/'.length), current: false };
  }
  if (fullName === 'HEAD') return { kind: 'head', name: 'HEAD', current: true };
  return { kind: 'other', name: fullName.replace(/^refs\//, ''), current: false };
}

/** Parses `%D` produced with `--decorate=full`. */
export function parseRefs(decoration: string): RefBadge[] {
  const badges: RefBadge[] = [];
  for (const raw of decoration.split(', ')) {
    const part = raw.trim();
    if (!part) continue;
    let badge: RefBadge | null;
    if (part.startsWith('HEAD -> ')) badge = classify(part.slice('HEAD -> '.length), true);
    else if (part.startsWith('tag: ')) badge = classify(part.slice('tag: '.length), false);
    else badge = classify(part, false);
    if (badge) badges.push(badge);
  }
  return badges;
}
