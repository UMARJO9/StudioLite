<script setup lang="ts">
// The sidebar's sections (files, chats, git). Each one folds to its header, the ones below
// the first open section can be resized, and they can be reordered by dragging a header.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useGitStore } from '../stores/git';
import { loadSetting, saveSetting, type SidebarSection } from '../utils/persist';
import ChatList from './ChatList.vue';
import FileTree from './FileTree.vue';
import GitGraph from './GitGraph.vue';
import Splitter from './Splitter.vue';

const emit = defineEmits<{ refresh: [] }>();

const git = useGitStore();

const DEFAULT_ORDER: SidebarSection[] = ['tree', 'chats', 'graph'];
const MIN_HEIGHT = 80;
const COLLAPSED_KEY = {
  tree: 'treeCollapsed',
  chats: 'chatsCollapsed',
  graph: 'graphCollapsed',
} as const;
const HEIGHT_KEY = { tree: 'treeHeight', chats: 'chatsHeight', graph: 'graphHeight' } as const;

const order = ref<SidebarSection[]>([...DEFAULT_ORDER]);
const collapsed = reactive<Record<SidebarSection, boolean>>({
  tree: false,
  chats: false,
  graph: false,
});
const heights = reactive<Record<SidebarSection, number>>({ tree: 260, chats: 180, graph: 280 });
const root = ref<HTMLElement | null>(null);

/** The topmost open section takes the free space; the others keep their own height. */
const growing = computed(() => order.value.find((s) => !collapsed[s]) ?? null);
const resizable = (s: SidebarSection) => !collapsed[s] && growing.value !== s;

function sectionStyle(s: SidebarSection) {
  if (collapsed[s]) return { flex: 'none' };
  if (growing.value === s) return { flex: '1' };
  return { flex: 'none', height: heights[s] + 'px' };
}

function toggle(s: SidebarSection) {
  collapsed[s] = !collapsed[s];
  saveSetting(COLLAPSED_KEY[s], collapsed[s]);
}

// --- resizing -----------------------------------------------------------------
let heightAtDragStart = 0;
function startResize(s: SidebarSection) {
  heightAtDragStart = heights[s];
}
function resize(s: SidebarSection, delta: number) {
  const available = root.value?.clientHeight ?? window.innerHeight;
  // The splitter sits above the section: dragging it up makes the section taller.
  heights[s] = Math.min(Math.max(heightAtDragStart - delta, MIN_HEIGHT), Math.max(MIN_HEIGHT, available - 160));
}

// --- reordering ---------------------------------------------------------------
/** Section whose header is being pressed; only then is it draggable, so that selecting
 *  text or dragging inside a section's content never starts a reorder. */
const armed = ref<SidebarSection | null>(null);
const dragged = ref<SidebarSection | null>(null);
const dropTarget = ref<{ section: SidebarSection; after: boolean } | null>(null);

function onPointerDown(e: PointerEvent, s: SidebarSection) {
  const target = e.target as HTMLElement;
  armed.value = target.closest('.panel-header') && !target.closest('button') ? s : null;
}
function disarm() {
  armed.value = null;
}

function onDragStart(e: DragEvent, s: SidebarSection) {
  if (armed.value !== s || !e.dataTransfer) {
    e.preventDefault();
    return;
  }
  dragged.value = s;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', s);
}

function onDragOver(e: DragEvent, s: SidebarSection) {
  if (!dragged.value) return; // something else is being dragged, e.g. a file
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget.value = { section: s, after: e.clientY > rect.top + rect.height / 2 };
}

function onDrop() {
  const moving = dragged.value;
  const target = dropTarget.value;
  if (moving && target && moving !== target.section) {
    const next = order.value.filter((s) => s !== moving);
    const index = next.indexOf(target.section) + (target.after ? 1 : 0);
    next.splice(index, 0, moving);
    order.value = next;
    saveSetting('sidebarOrder', next);
  }
  endDrag();
}

function endDrag() {
  dragged.value = null;
  dropTarget.value = null;
  armed.value = null;
}

function isValidOrder(value: unknown): value is SidebarSection[] {
  return (
    Array.isArray(value) &&
    value.length === DEFAULT_ORDER.length &&
    DEFAULT_ORDER.every((s) => value.includes(s))
  );
}

onMounted(async () => {
  window.addEventListener('pointerup', disarm);
  const savedOrder = await loadSetting('sidebarOrder');
  if (isValidOrder(savedOrder)) order.value = savedOrder;
  for (const s of DEFAULT_ORDER) {
    const [isCollapsed, height] = await Promise.all([
      loadSetting(COLLAPSED_KEY[s]),
      loadSetting(HEIGHT_KEY[s]),
    ]);
    collapsed[s] = isCollapsed === true;
    if (height) heights[s] = Math.max(MIN_HEIGHT, height);
  }
});
onBeforeUnmount(() => window.removeEventListener('pointerup', disarm));
</script>

<template>
  <div ref="root" class="sections">
    <template v-for="s in order" :key="s">
      <Splitter
        v-show="resizable(s)"
        direction="horizontal"
        @start="startResize(s)"
        @drag="(delta) => resize(s, delta)"
        @end="saveSetting(HEIGHT_KEY[s], heights[s])"
      />
      <section
        class="pane"
        :class="{
          'no-splitter': !resizable(s) && order[0] !== s,
          dragged: dragged === s,
          'drop-before': dropTarget?.section === s && !dropTarget.after && dragged !== s,
          'drop-after': dropTarget?.section === s && dropTarget.after && dragged !== s,
        }"
        :style="sectionStyle(s)"
        :draggable="armed === s"
        @pointerdown="onPointerDown($event, s)"
        @dragstart="onDragStart($event, s)"
        @dragover="onDragOver($event, s)"
        @drop.prevent="onDrop"
        @dragend="endDrag"
      >
        <FileTree
          v-if="s === 'tree'"
          :collapsed="collapsed.tree"
          @refresh="emit('refresh')"
          @toggle="toggle('tree')"
        />
        <ChatList v-else-if="s === 'chats'" :collapsed="collapsed.chats" @toggle="toggle('chats')" />
        <GitGraph v-else :collapsed="collapsed.graph" @refresh="git.refresh()" @toggle="toggle('graph')" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.sections {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.pane {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.pane.no-splitter {
  border-top: 1px solid var(--border);
}
.pane.dragged {
  opacity: 0.45;
}
/* Where the dragged section will land. */
.pane.drop-before::before,
.pane.drop-after::after {
  content: '';
  position: absolute;
  right: 0;
  left: 0;
  z-index: 10;
  height: 2px;
  background: var(--accent);
  pointer-events: none;
}
.pane.drop-before::before {
  top: 0;
}
.pane.drop-after::after {
  bottom: 0;
}
.pane :deep(.panel-header.toggle) {
  cursor: grab;
}
</style>
