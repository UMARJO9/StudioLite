import type { OutputStream } from '../api/types';

export type ConsoleLevel = 'normal' | 'error' | 'warning' | 'info' | 'success';

// `e:` / `w:` are Kotlin compiler prefixes; the rest covers Gradle, AAPT, javac and lint.
const ERROR_RE = /^e: |\berrors?\b|\bFAILED\b|\bFAILURE\b|\bException\b|^Caused by:/i;
const WARNING_RE = /^w: |\bwarn(ing)?s?\b|\bdeprecated\b/i;
const SUCCESS_RE = /^BUILD SUCCESSFUL\b/;

export function classifyLine(stream: OutputStream, text: string): ConsoleLevel {
  if (stream === 'info') return 'info';
  if (SUCCESS_RE.test(text)) return 'success';
  if (ERROR_RE.test(text)) return 'error';
  if (WARNING_RE.test(text)) return 'warning';
  return 'normal';
}
