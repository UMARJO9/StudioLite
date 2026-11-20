<script setup lang="ts">
import { CircleAlert, CircleCheck, CircleX, Info, X } from 'lucide-vue-next';
import { useToastsStore, type ToastType } from '../stores/toasts';

const toasts = useToastsStore();

const icons: Record<ToastType, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
};
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts.items" :key="t.id" class="toast" :class="t.type">
        <component :is="icons[t.type]" :size="16" class="toast-icon" />
        <span class="toast-text">{{ t.text }}</span>
        <button class="btn small icon" title="Закрыть" @click="toasts.dismiss(t.id)">
          <X :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(420px, calc(100vw - 24px));
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 8px 8px 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-left-width: 3px;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
  pointer-events: auto;
}
.toast-icon {
  flex: none;
  margin-top: 2px;
}
.toast-text {
  flex: 1;
  min-width: 0;
  color: var(--text-bright);
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}
.toast.info {
  border-left-color: var(--blue);
}
.toast.info .toast-icon {
  color: var(--blue);
}
.toast.success {
  border-left-color: var(--green);
}
.toast.success .toast-icon {
  color: var(--green);
}
.toast.warning {
  border-left-color: var(--yellow);
}
.toast.warning .toast-icon {
  color: var(--yellow);
}
.toast.error {
  border-left-color: var(--red);
}
.toast.error .toast-icon {
  color: var(--red);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
