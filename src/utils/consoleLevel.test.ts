import { describe, expect, it } from 'vitest';
import { classifyLine } from './consoleLevel';

describe('classifyLine', () => {
  it.each([
    ['e: file:///app/Main.kt:12:5 Unresolved reference: foo', 'error'],
    ['> Task :app:compileDebugKotlin FAILED', 'error'],
    ['FAILURE: Build failed with an exception.', 'error'],
    ['Caused by: java.lang.IllegalStateException', 'error'],
    ['error: cannot find symbol', 'error'],
    ['w: file:///app/Main.kt:3:1 Parameter is never used', 'warning'],
    ['warning: [options] source value 8 is obsolete', 'warning'],
    ['WARNING: API is deprecated', 'warning'],
    ['BUILD SUCCESSFUL in 12s', 'success'],
    ['> Task :app:mergeDebugResources UP-TO-DATE', 'normal'],
  ] as const)('%s → %s', (text, level) => {
    expect(classifyLine('stdout', text)).toBe(level);
  });

  it('marks lines written by StudioLite itself as info, whatever they say', () => {
    expect(classifyLine('info', '> gradlew :app:assembleDebug (error?)')).toBe('info');
  });
});
