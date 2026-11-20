import { describe, expect, it } from 'vitest';
import { buildStatusIndex, lookupStatus } from './gitStatus';

const root = '/repo';
const index = buildStatusIndex(
  [
    { path: '/repo/app/src/Main.kt', status: 'modified', isDir: false },
    { path: '/repo/app/src/New.kt', status: 'added', isDir: false },
    { path: '/repo/lib/a/One.kt', status: 'untracked', isDir: false },
    { path: '/repo/lib/a/Two.kt', status: 'added', isDir: false },
    { path: '/repo/fresh', status: 'untracked', isDir: true },
    { path: '/repo/core/Gone.kt', status: 'deleted', isDir: false },
    { path: '/repo/merge/x/Both.kt', status: 'conflict', isDir: false },
    { path: '/repo/merge/Ok.kt', status: 'modified', isDir: false },
  ],
  root,
  '/',
);
const status = (p: string) => lookupStatus(index, p, '/');

describe('git status index', () => {
  it('returns file statuses as reported', () => {
    expect(status('/repo/app/src/Main.kt')).toBe('modified');
    expect(status('/repo/core/Gone.kt')).toBe('deleted');
    expect(status('/repo/app/src/Clean.kt')).toBeNull();
  });

  it('marks every ancestor folder of a change, but not the root', () => {
    expect(status('/repo/app')).toBe('modified');
    expect(status('/repo/app/src')).toBe('modified');
    expect(status('/repo')).toBeNull();
  });

  it('keeps a folder green when it only contains new files', () => {
    expect(status('/repo/lib')).toBe('added');
    expect(status('/repo/lib/a')).toBe('added');
  });

  it('shows a folder with a deleted file as modified', () => {
    expect(status('/repo/core')).toBe('modified');
  });

  it('lets a conflict win over other statuses', () => {
    expect(status('/repo/merge')).toBe('conflict');
  });

  it('treats everything inside an untracked folder as untracked', () => {
    expect(status('/repo/fresh')).toBe('untracked');
    expect(status('/repo/fresh/deep/File.kt')).toBe('untracked');
    expect(status('/repo/freshness.txt')).toBeNull();
  });
});
