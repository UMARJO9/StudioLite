import type { AppError } from '../api/types';

/** Normalises anything thrown by invoke() or by our own code. */
export function toAppError(e: unknown): AppError {
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.kind === 'string' && typeof obj.message === 'string') {
      return { kind: obj.kind, message: obj.message };
    }
    if (e instanceof Error) return { kind: 'unknown', message: e.message };
  }
  return { kind: 'unknown', message: typeof e === 'string' ? e : String(e) };
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}
