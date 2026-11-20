<script setup lang="ts" generic="T">
// Fixed-row-height virtual list: only the visible slice is in the DOM.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    items: readonly T[];
    rowHeight: number;
    overscan?: number;
    keyOf?: (item: T, index: number) => string | number;
    /** Rows take the list's width (and can ellipsize) instead of scrolling horizontally. */
    fit?: boolean;
  }>(),
  { overscan: 8, keyOf: undefined, fit: false },
);

const emit = defineEmits<{ scroll: [atBottom: boolean] }>();

defineSlots<{
  default(props: { item: T; index: number }): unknown;
  footer?(): unknown;
}>();

const el = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);

const start = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan),
);
const end = computed(() =>
  Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / props.rowHeight) + props.overscan,
  ),
);
const visible = computed(() => props.items.slice(start.value, end.value));

function isAtBottom(): boolean {
  const node = el.value;
  return !node || node.scrollHeight - node.scrollTop - node.clientHeight < props.rowHeight;
}

function onScroll() {
  if (!el.value) return;
  scrollTop.value = el.value.scrollTop;
  emit('scroll', isAtBottom());
}

function scrollToBottom() {
  const node = el.value;
  if (!node) return;
  node.scrollTop = node.scrollHeight;
  scrollTop.value = node.scrollTop;
}

function scrollToTop() {
  if (el.value) el.value.scrollTop = 0;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!el.value) return;
  viewportHeight.value = el.value.clientHeight;
  observer = new ResizeObserver(() => {
    if (el.value) viewportHeight.value = el.value.clientHeight;
  });
  observer.observe(el.value);
});
onBeforeUnmount(() => observer?.disconnect());

defineExpose({ scrollToBottom, scrollToTop, isAtBottom });
</script>

<template>
  <div ref="el" class="vlist" @scroll.passive="onScroll">
    <div
      class="vlist-inner"
      :class="{ fit }"
      :style="{ height: items.length * rowHeight + 'px', paddingTop: start * rowHeight + 'px' }"
    >
      <div
        v-for="(item, i) in visible"
        :key="keyOf ? keyOf(item, start + i) : start + i"
        class="vlist-row"
        :style="{ height: rowHeight + 'px' }"
      >
        <slot :item="item" :index="start + i" />
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>

<style scoped>
.vlist {
  height: 100%;
  overflow: auto;
  overflow-anchor: none;
}
.vlist-inner {
  box-sizing: border-box;
  /* Grows with the widest visible row so long lines scroll horizontally. */
  width: max-content;
  min-width: 100%;
}
.vlist-inner.fit {
  width: 100%;
}
.vlist-row {
  overflow: hidden;
}
</style>
