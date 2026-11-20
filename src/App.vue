<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ChevronLeft, ChevronRight, FolderOpen, TriangleAlert } from 'lucide-vue-next';
import AppToolbar from './components/AppToolbar.vue';
import ConsolePanel from './components/ConsolePanel.vue';
import FileTree from './components/FileTree.vue';
import GitGraph from './components/GitGraph.vue';
import Splitter from './components/Splitter.vue';
import ToastHost from './components/ToastHost.vue';
import { useDevicesStore } from './stores/devices';
import { useGitStore } from './stores/git';
import { useProjectStore } from './stores/project';
import { useTasksStore } from './stores/tasks';
import { useToastsStore } from './stores/toasts';
import { useTreeStore } from './stores/tree';
import { loadSetting, saveSetting } from './utils/persist';

const project = useProjectStore();
const tree = useTreeStore();
const git = useGitStore();
const toasts = useToastsStore();
const devices = useDevicesStore();
const tasks = useTasksStore();

// --- data refresh -----------------------------------------------------------
// No timers: data is reloaded when a project opens, when the window regains focus,
// after a task finishes and on the refresh buttons.
async function refreshProjectData() {
  await Promise.all([tree.refresh(), git.refresh()]);
}

watch(
  () => project.path,
  () => {
    tree.reset();
    git.reset();
    void refreshProjectData();
    // sdk.dir in local.properties may point at a different SDK for this project.
    void devices.refresh();
  },
);

const FOCUS_REFRESH_MIN_INTERVAL_MS = 2000;
let lastFocusRefresh = 0;
function onWindowFocus() {
  const now = Date.now();
  if (now - lastFocusRefresh < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
  lastFocusRefresh = now;
  void refreshProjectData();
  void devices.refresh();
}
let unlistenFocus: (() => void) | null = null;

// --- resizable panels -------------------------------------------------------
const SIDEBAR_MIN = 180;
const GRAPH_MIN = 80;
const sidebarWidth = ref(320);
const sidebarCollapsed = ref(false);
const graphHeight = ref(280);
const sidebarEl = ref<HTMLElement | null>(null);
let sizeAtDragStart = 0;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  saveSetting('sidebarCollapsed', sidebarCollapsed.value);
}
/** Cmd+B on macOS, Ctrl+B elsewhere — same as in VS Code. */
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyB') {
    e.preventDefault();
    toggleSidebar();
  }
}

function startSidebarDrag() {
  sizeAtDragStart = sidebarWidth.value;
}
function dragSidebar(delta: number) {
  sidebarWidth.value = clamp(sizeAtDragStart + delta, SIDEBAR_MIN, window.innerWidth - 300);
}
function startGraphDrag() {
  sizeAtDragStart = graphHeight.value;
}
function dragGraph(delta: number) {
  const available = sidebarEl.value?.clientHeight ?? window.innerHeight;
  graphHeight.value = clamp(sizeAtDragStart - delta, GRAPH_MIN, available - 100);
}

// --- center tabs ------------------------------------------------------------
// Only the build console for now; logcat and others will be added here.
const tabs = [{ id: 'build', title: 'Сборка' }] as const;
type TabId = (typeof tabs)[number]['id'];
const activeTab = ref<TabId>('build');

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  const [width, height, collapsed] = await Promise.all([
    loadSetting('sidebarWidth'),
    loadSetting('graphHeight'),
    loadSetting('sidebarCollapsed'),
  ]);
  sidebarCollapsed.value = collapsed === true;
  if (width) sidebarWidth.value = clamp(width, SIDEBAR_MIN, window.innerWidth - 300);
  if (height) graphHeight.value = Math.max(GRAPH_MIN, height);
  try {
    unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) onWindowFocus();
    });
  } catch (e) {
    toasts.error(e, 'Подписка на фокус окна');
  }
  await Promise.all([devices.restore(), tasks.restore()]);
  await project.restore();
  // Opening a project refreshes devices itself; cover the "no project yet" start.
  if (!project.info) void devices.refresh();
});

onBeforeUnmount(() => {
  unlistenFocus?.();
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="app">
    <AppToolbar />

    <div v-if="project.problems.length" class="banner">
      <TriangleAlert :size="14" />
      <span>{{ project.problems.join(' ') }}</span>
    </div>

    <div v-if="!project.info" class="empty welcome">
      <div class="welcome-title">StudioLite</div>
      <div>Откройте папку Android-проекта, чтобы начать.</div>
      <button class="btn primary" :disabled="project.opening" @click="project.pickAndOpen()">
        <FolderOpen :size="16" />
        Открыть проект
      </button>
    </div>

    <div v-else class="body">
      <aside
        v-show="!sidebarCollapsed"
        ref="sidebarEl"
        class="sidebar"
        :style="{ width: sidebarWidth + 'px' }"
      >
        <section class="pane tree-pane">
          <FileTree @refresh="refreshProjectData" />
        </section>
        <Splitter
          direction="horizontal"
          @start="startGraphDrag"
          @drag="dragGraph"
          @end="saveSetting('graphHeight', graphHeight)"
        />
        <section class="pane" :style="{ height: graphHeight + 'px', flex: 'none' }">
          <GitGraph @refresh="git.refresh()" />
        </section>
      </aside>
      <Splitter
        v-show="!sidebarCollapsed"
        direction="vertical"
        @start="startSidebarDrag"
        @drag="dragSidebar"
        @end="saveSetting('sidebarWidth', sidebarWidth)"
      />
      <!-- Sits on the sidebar's edge at mid-height, so it is a short reach from anywhere. -->
      <button
        class="sidebar-handle"
        :style="{ left: sidebarCollapsed ? '0px' : sidebarWidth + 'px' }"
        :title="
          sidebarCollapsed
            ? 'Показать боковую панель (⌘B / Ctrl+B)'
            : 'Скрыть боковую панель (⌘B / Ctrl+B)'
        "
        :aria-expanded="!sidebarCollapsed"
        @click="toggleSidebar"
      >
        <ChevronRight v-if="sidebarCollapsed" :size="14" />
        <ChevronLeft v-else :size="14" />
      </button>
      <main class="center">
        <div class="tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="tab"
            :class="{ active: activeTab === tab.id }"
            role="tab"
            :aria-selected="activeTab === tab.id"
            @click="activeTab = tab.id"
          >
            {{ tab.title }}
          </button>
        </div>
        <div class="tab-content">
          <ConsolePanel v-show="activeTab === 'build'" />
        </div>
      </main>
    </div>

    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.banner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 5px 12px;
  background: #3d3223;
  border-bottom: 1px solid var(--border);
  color: var(--yellow);
  font-size: 12px;
}
.welcome-title {
  color: var(--text-bright);
  font-size: 22px;
  font-weight: 600;
}
.body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.sidebar-handle {
  position: absolute;
  top: 50%;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 56px;
  padding: 0;
  transform: translateY(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-left: none;
  border-radius: 0 6px 6px 0;
  color: var(--text-dim);
  opacity: 0.75;
}
.sidebar-handle:hover,
.sidebar-handle:focus-visible {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  opacity: 1;
  outline: none;
}
.sidebar {
  display: flex;
  flex-direction: column;
  flex: none;
  min-width: 0;
  background: var(--bg-panel);
}
.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.tree-pane {
  flex: 1;
}
.center {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.tabs {
  display: flex;
  flex: none;
  height: var(--panel-header-height);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.tab {
  padding: 0 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  border-bottom-color: var(--accent);
  color: var(--text-bright);
}
.tab-content {
  flex: 1;
  min-height: 0;
}
</style>
