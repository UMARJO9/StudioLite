<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, type Component } from 'vue';

export interface MenuItem {
  label: string;
  icon?: Component;
  action: () => void;
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ close: [] }>();

const el = ref<HTMLElement | null>(null);
const left = ref(props.x);
const top = ref(props.y);

function run(item: MenuItem) {
  emit('close');
  item.action();
}

function onPointerDown(e: PointerEvent) {
  if (el.value && !el.value.contains(e.target as Node)) emit('close');
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
function close() {
  emit('close');
}

onMounted(async () => {
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  await nextTick();
  // Keep the menu inside the window.
  const rect = el.value?.getBoundingClientRect();
  if (rect) {
    left.value = Math.max(4, Math.min(props.x, window.innerWidth - rect.width - 4));
    top.value = Math.max(4, Math.min(props.y, window.innerHeight - rect.height - 4));
  }
  el.value?.querySelector<HTMLElement>('button')?.focus();
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('blur', close);
  window.removeEventListener('resize', close);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="el"
      class="menu"
      role="menu"
      :style="{ left: left + 'px', top: top + 'px' }"
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.label"
        class="menu-item"
        role="menuitem"
        @click="run(item)"
      >
        <component :is="item.icon" v-if="item.icon" :size="14" />
        <span>{{ item.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 900;
  min-width: 200px;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--bg-active);
  color: var(--text-bright);
  outline: none;
}
</style>
