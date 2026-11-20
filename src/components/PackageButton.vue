<script setup lang="ts">
// Builds distributable files and collects them in <project>/dist/<variant>.
import { onBeforeUnmount, ref, watch } from 'vue';
import { ChevronDown, Package } from 'lucide-vue-next';
import { useTasksStore, type TaskKind } from '../stores/tasks';

const tasks = useTasksStore();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const OPTIONS: { kind: TaskKind; title: string; hint: string }[] = [
  { kind: 'packageDebug', title: 'Debug', hint: 'APK → dist/debug' },
  { kind: 'packageRelease', title: 'Release', hint: 'APK и AAB → dist/release' },
];

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
  <div ref="root" class="package">
    <button
      class="btn outlined"
      :disabled="!!tasks.blockedReason('packageDebug')"
      :title="tasks.blockedReason('packageDebug') ?? 'Собрать APK / AAB в отдельную папку'"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Package :size="15" />
      <span>Сборка APK</span>
      <ChevronDown :size="14" />
    </button>

    <div v-if="open" class="menu" role="menu">
      <button
        v-for="option in OPTIONS"
        :key="option.kind"
        class="menu-item"
        role="menuitem"
        @click="start(option.kind)"
      >
        <span class="menu-title">{{ option.title }}</span>
        <span class="menu-hint">{{ option.hint }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.package {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 800;
  width: 240px;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
}
.menu-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  text-align: left;
}
.menu-item:hover {
  background: var(--bg-hover);
}
.menu-title {
  color: var(--text-bright);
}
.menu-hint {
  color: var(--text-dim);
  font-size: 11px;
}
</style>
