<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { Check, ChevronDown, Hammer, Play, Square } from 'lucide-vue-next';
import { TASK_TITLE, useTasksStore, type TaskKind } from '../stores/tasks';

const tasks = useTasksStore();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const ACTIONS: { kind: TaskKind; icon: Component; hint: string }[] = [
  { kind: 'build', icon: Hammer, hint: 'Собрать debug APK' },
  { kind: 'run', icon: Play, hint: 'Установить и запустить на устройстве' },
];

const current = computed(() => ACTIONS.find((a) => a.kind === tasks.lastAction) ?? ACTIONS[0]);
const blocked = computed(() => tasks.blockedReason(current.value.kind));

function start(kind: TaskKind) {
  open.value = false;
  void tasks.start(kind);
}

function onPointerDown(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
function close() {
  open.value = false;
}
function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('pointerdown', onPointerDown as EventListener, true);
  window[method]('keydown', onKey as EventListener);
  window[method]('blur', close);
}
watch(open, listen);
onBeforeUnmount(() => listen(false));
</script>

<template>
  <div ref="root" class="build">
    <div class="split">
      <button
        class="btn primary main"
        :disabled="!!blocked"
        :title="blocked ?? current.hint"
        @click="start(current.kind)"
      >
        <component :is="current.icon" :size="15" />
        <span>{{ TASK_TITLE[current.kind] }}</span>
      </button>
      <button
        class="btn primary caret"
        :disabled="tasks.isRunning"
        title="Выбрать действие"
        aria-haspopup="menu"
        :aria-expanded="open"
        @click="open = !open"
      >
        <ChevronDown :size="14" />
      </button>
    </div>
    <button
      class="btn icon stop"
      :disabled="!tasks.isRunning || tasks.stopping"
      :title="tasks.stopping ? 'Останавливается…' : 'Остановить задачу'"
      @click="tasks.stop()"
    >
      <Square :size="14" />
    </button>

    <div v-if="open" class="menu" role="menu">
      <button
        v-for="action in ACTIONS"
        :key="action.kind"
        class="menu-item"
        role="menuitem"
        :disabled="!!tasks.blockedReason(action.kind)"
        :title="tasks.blockedReason(action.kind) ?? action.hint"
        @click="start(action.kind)"
      >
        <component :is="action.icon" :size="15" />
        <span class="menu-text">
          <span class="menu-title">{{ TASK_TITLE[action.kind] }}</span>
          <span class="menu-hint">{{ action.hint }}</span>
        </span>
        <Check v-if="action.kind === tasks.lastAction" :size="14" class="check" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.build {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
}
.split {
  display: flex;
}
.main {
  min-width: 76px;
  border-radius: 6px 0 0 6px;
}
.caret {
  width: 24px;
  padding: 0;
  justify-content: center;
  border-left: 1px solid rgb(0 0 0 / 25%);
  border-radius: 0 6px 6px 0;
}
.stop:not(:disabled) {
  color: var(--red);
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 800;
  width: 280px;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  text-align: left;
}
.menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}
.menu-item:disabled {
  opacity: 0.45;
}
.menu-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.menu-title {
  color: var(--text-bright);
}
.menu-hint {
  color: var(--text-dim);
  font-size: 11px;
}
.check {
  flex: none;
  color: var(--accent);
}
</style>
