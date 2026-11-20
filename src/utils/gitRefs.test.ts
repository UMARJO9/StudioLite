import { describe, expect, it } from 'vitest';
import { parseRefs } from './gitRefs';

describe('parseRefs', () => {
  it('returns nothing for an undecorated commit', () => {
    expect(parseRefs('')).toEqual([]);
  });

  it('recognises the current branch, remotes and tags', () => {
    expect(
      parseRefs(
        'HEAD -> refs/heads/main, tag: refs/tags/v1.0, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/feature/login',
      ),
    ).toEqual([
      { kind: 'branch', name: 'main', current: true },
      { kind: 'tag', name: 'v1.0', current: false },
      { kind: 'remote', name: 'origin/main', current: false },
      { kind: 'branch', name: 'feature/login', current: false },
    ]);
  });

  it('shows a detached HEAD and stash', () => {
    expect(parseRefs('HEAD, refs/stash')).toEqual([
      { kind: 'head', name: 'HEAD', current: true },
      { kind: 'other', name: 'stash', current: false },
    ]);
  });
});
