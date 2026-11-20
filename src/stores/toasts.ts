import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '../utils/errors';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  type: ToastType;
  text: string;
}

const LIFETIME_MS: Record<ToastType, number> = {
  info: 4000,
  success: 4000,
  warning: 7000,
  error: 9000,
};
const MAX_VISIBLE = 5;

export const useToastsStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);
  let nextId = 1;

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  function push(type: ToastType, text: string) {
    // The same failure repeated on every window focus should not stack up.
    if (items.value.some((t) => t.type === type && t.text === text)) return;
    const id = nextId++;
    items.value = [...items.value, { id, type, text }].slice(-MAX_VISIBLE);
    setTimeout(() => dismiss(id), LIFETIME_MS[type]);
  }

  return {
    items,
    dismiss,
    info: (text: string) => push('info', text),
    success: (text: string) => push('success', text),
    warning: (text: string) => push('warning', text),
    /** Accepts whatever was thrown. */
    error: (e: unknown, prefix?: string) => {
      console.error(prefix ?? 'error', e);
      const message = errorMessage(e);
      push('error', prefix ? `${prefix}: ${message}` : message);
    },
  };
});
