<script setup lang="ts">
// A draggable divider. Reports the pointer delta since drag start; the parent owns the size.
const props = defineProps<{ direction: 'vertical' | 'horizontal' }>();
const emit = defineEmits<{ start: []; drag: [delta: number]; end: [] }>();

let origin = 0;
let dragging = false;

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging = true;
  origin = props.direction === 'vertical' ? e.clientX : e.clientY;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  emit('start');
}

function onMove(e: PointerEvent) {
  if (!dragging) return;
  emit('drag', (props.direction === 'vertical' ? e.clientX : e.clientY) - origin);
}

function onUp() {
  if (!dragging) return;
  dragging = false;
  emit('end');
}
</script>

<template>
  <div
    class="splitter"
    :class="direction"
    role="separator"
    :aria-orientation="direction === 'vertical' ? 'vertical' : 'horizontal'"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  />
</template>

<style scoped>
.splitter {
  position: relative;
  flex: none;
  background: var(--border);
  z-index: 5;
}
.splitter::after {
  content: '';
  position: absolute;
  transition: background 0.1s;
}
.splitter:hover::after,
.splitter:active::after {
  background: var(--accent);
}
.splitter.vertical {
  width: 1px;
  cursor: col-resize;
}
.splitter.vertical::after {
  inset: 0 -2px;
}
.splitter.horizontal {
  height: 1px;
  cursor: row-resize;
}
.splitter.horizontal::after {
  inset: -2px 0;
}
</style>
