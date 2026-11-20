<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Hammer,
  MessageSquare,
  TriangleAlert,
  X,
} from 'lucide-vue-next';
import AppToolbar from './components/AppToolbar.vue';
import ChatList from './components/ChatList.vue';
import ChatView from './components/ChatView.vue';
import ConsolePanel from './components/ConsolePanel.vue';
import FileViewer from './components/FileViewer.vue';
import FileTree from './components/FileTree.vue';
import GitGraph from './components/GitGraph.vue';
import Splitter from './components/Splitter.vue';
import ToastHost from './components/ToastHost.vue';
import { chatTabId, useChatsStore } from './stores/chats';
import { useDevicesStore } from './stores/devices';
import { useGitStore } from './stores/git';
import { useProjectStore } from './stores/project';
import { useTasksStore } from './stores/tasks';
import { useToastsStore } from './stores/toasts';
import { useTreeStore } from './stores/tree';
import { BUILD_TAB, NO_TAB, useViewerStore } from './stores/viewer';
import { loadSetting, saveSetting } from './utils/persist';

const project = useProjectStore();
const tree = useTreeStore();
const git = useGitStore();
const toasts = useToastsStore();
const devices = useDevicesStore();
const tasks = useTasksStore();
const viewer = useViewerStore();
const chats = useChatsStore();

// --- data refresh -----------------------------------------------------------
// No timers: data is reloaded when a project opens, when the window regains focus,
// after a task finishes and on the refresh buttons.
async function refreshProjectData() {
  await Promise.all([tree.refresh(), git.refresh(), viewer.reloadActive()]);
}

watch(
  () => project.path,
  () => {
    tree.reset();
    git.reset();
    viewer.reset();
    void chats.loadFor(project.path);
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
// Each sidebar section folds down to its header on its own.
const treeCollapsed = ref(false);
const graphCollapsed = ref(false);
const chatsCollapsed = ref(false);
const chatsHeight = ref(180);
const SECTION_MIN = 80;
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
function toggleTree() {
  treeCollapsed.value = !treeCollapsed.value;
  saveSetting('treeCollapsed', treeCollapsed.value);
}
function toggleGraph() {
  graphCollapsed.value = !graphCollapsed.value;
  saveSetting('graphCollapsed', graphCollapsed.value);
}
function toggleChats() {
  chatsCollapsed.value = !chatsCollapsed.value;
  saveSetting('chatsCollapsed', chatsCollapsed.value);
}

// Sidebar sections from top to bottom: files, chats, git. The topmost open one takes the
// free space; the ones below it keep the height they were dragged to.
type Section = 'tree' | 'chats' | 'graph';
const growingSection = computed<Section | null>(() => {
  if (!treeCollapsed.value) return 'tree';
  if (!chatsCollapsed.value) return 'chats';
  if (!graphCollapsed.value) return 'graph';
  return null;
});
function sectionStyle(section: Section, collapsed: boolean, height: number) {
  if (collapsed) return { flex: 'none' };
  if (growingSection.value === section) return { flex: '1' };
  return { flex: 'none', height: height + 'px' };
}
/** A section can be resized only when it is open and something above it takes the rest. */
const chatsResizable = computed(() => !chatsCollapsed.value && growingSection.value !== 'chats');
const graphResizable = computed(() => !graphCollapsed.value && growingSection.value !== 'graph');

function startChatsDrag() {
  sizeAtDragStart = chatsHeight.value;
}
function dragChats(delta: number) {
  const available = sidebarEl.value?.clientHeight ?? window.innerHeight;
  chatsHeight.value = clamp(sizeAtDragStart - delta, SECTION_MIN, available - 160);
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
// The build console plus one tab per file open in the viewer; logcat will be added here.
function closeTab(path: string) {
  viewer.close(path);
}

// When the selected tab goes away and its neighbours are gone too, fall back to any tab left.
const openTabIds = computed(() => [
  ...(viewer.buildOpen ? [BUILD_TAB] : []),
  ...viewer.tabs.map((tab) => tab.path),
  ...chats.openChats.map((chat) => chatTabId(chat.id)),
]);
watch([openTabIds, () => viewer.active], ([ids, active]) => {
  if (!ids.includes(active)) viewer.active = ids[ids.length - 1] ?? NO_TAB;
});

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  const [savedChatsHeight, chatsFolded] = await Promise.all([
    loadSetting('chatsHeight'),
    loadSetting('chatsCollapsed'),
  ]);
  if (savedChatsHeight) chatsHeight.value = Math.max(SECTION_MIN, savedChatsHeight);
  chatsCollapsed.value = chatsFolded === true;
  const [width, height, collapsed, treeFolded, graphFolded] = await Promise.all([
    loadSetting('sidebarWidth'),
    loadSetting('graphHeight'),
    loadSetting('sidebarCollapsed'),
    loadSetting('treeCollapsed'),
    loadSetting('graphCollapsed'),
  ]);
  sidebarCollapsed.value = collapsed === true;
  treeCollapsed.value = treeFolded === true;
  graphCollapsed.value = graphFolded === true;
  if (width) sidebarWidth.value = clamp(width, SIDEBAR_MIN, window.innerWidth - 300);
  if (height) graphHeight.value = Math.max(GRAPH_MIN, height);
  try {
    unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) onWindowFocus();
    });
  } catch (e) {
    toasts.error(e, 'Подписка на фокус окна');
  }
  await Promise.all([devices.restore(), tasks.restore(), chats.restore()]);
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
        <section class="pane" :style="sectionStyle('tree', treeCollapsed, 0)">
          <FileTree :collapsed="treeCollapsed" @refresh="refreshProjectData" @toggle="toggleTree" />
        </section>
        <Splitter
          v-show="chatsResizable"
          direction="horizontal"
          @start="startChatsDrag"
          @drag="dragChats"
          @end="saveSetting('chatsHeight', chatsHeight)"
        />
        <section
          class="pane"
          :class="{ 'no-splitter': !chatsResizable }"
          :style="sectionStyle('chats', chatsCollapsed, chatsHeight)"
        >
          <ChatList :collapsed="chatsCollapsed" @toggle="toggleChats" />
        </section>
        <Splitter
          v-show="graphResizable"
          direction="horizontal"
          @start="startGraphDrag"
          @drag="dragGraph"
          @end="saveSetting('graphHeight', graphHeight)"
        />
        <section
          class="pane"
          :class="{ 'no-splitter': !graphResizable }"
          :style="sectionStyle('graph', graphCollapsed, graphHeight)"
        >
          <GitGraph :collapsed="graphCollapsed" @refresh="git.refresh()" @toggle="toggleGraph" />
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
          <div
            v-if="viewer.buildOpen"
            class="tab file"
            :class="{ active: viewer.active === BUILD_TAB }"
            role="tab"
            :aria-selected="viewer.active === BUILD_TAB"
            title="Вывод сборки"
            @click="viewer.showBuild()"
            @auxclick.middle="viewer.closeBuild()"
          >
            <Hammer :size="13" class="tab-icon" :class="{ busy: tasks.isRunning }" />
            <span class="tab-name">Сборка</span>
            <button
              class="tab-close"
              title="Закрыть (откроется снова при следующей сборке)"
              aria-label="Закрыть вкладку"
              @click.stop="viewer.closeBuild()"
            >
              <X :size="12" />
            </button>
          </div>
          <div
            v-for="tab in viewer.tabs"
            :key="tab.path"
            class="tab file"
            :class="[
              git.statusOf(tab.path) ?? 'clean',
              { active: viewer.active === tab.path, preview: tab.preview },
            ]"
            role="tab"
            :aria-selected="viewer.active === tab.path"
            :title="tab.preview ? tab.path + '\nДвойной клик — закрепить вкладку' : tab.path"
            @click="viewer.active = tab.path"
            @dblclick="viewer.pin(tab.path)"
            @auxclick.middle="closeTab(tab.path)"
          >
            <span class="tab-name">{{ tab.name }}</span>
            <button
              class="tab-close"
              title="Закрыть"
              aria-label="Закрыть вкладку"
              @click.stop="closeTab(tab.path)"
            >
              <X :size="12" />
            </button>
          </div>
          <div
            v-for="chat in chats.openChats"
            :key="chat.id"
            class="tab file"
            :class="{ active: viewer.active === chatTabId(chat.id) }"
            role="tab"
            :aria-selected="viewer.active === chatTabId(chat.id)"
            :title="chat.title"
            @click="viewer.active = chatTabId(chat.id)"
            @auxclick.middle="chats.closeTab(chat.id)"
          >
            <MessageSquare :size="13" class="tab-icon" :class="{ busy: chats.runtimeOf(chat.id).running }" />
            <span class="tab-name ellipsis">{{ chat.title }}</span>
            <button
              class="tab-close"
              title="Закрыть вкладку (чат останется в списке)"
              aria-label="Закрыть вкладку"
              @click.stop="chats.closeTab(chat.id)"
            >
              <X :size="12" />
            </button>
          </div>
        </div>
        <div class="tab-content">
          <div v-if="viewer.active === NO_TAB" class="empty">
            <span>Нет открытых вкладок.</span>
            <span class="empty-hint">
              Выберите файл в дереве, начните чат или запустите сборку — её вывод откроется здесь.
            </span>
          </div>
          <ConsolePanel v-show="viewer.active === BUILD_TAB" />
          <FileViewer v-if="viewer.activeFile" :tab="viewer.activeFile" />
          <ChatView v-if="chats.activeChat" :chat="chats.activeChat" />
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
.empty-hint {
  max-width: 420px;
  font-size: 12px;
}
.tabs .tab.file:first-child {
  border-left: none;
}
.tab-icon {
  flex: none;
  color: var(--text-dim);
}
.tab-icon.busy {
  color: var(--accent);
}
.tab.file .tab-name {
  max-width: 180px;
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
.pane.no-splitter {
  border-top: 1px solid var(--border);
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
.tabs {
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  flex: none;
  white-space: nowrap;
}
.tab.file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 6px;
  border-left: 1px solid var(--border);
}
.tab.preview .tab-name {
  font-style: italic;
}
.tab.modified .tab-name {
  color: var(--git-modified);
}
.tab.added .tab-name,
.tab.untracked .tab-name {
  color: var(--git-added);
}
.tab.conflict .tab-name {
  color: var(--git-conflict);
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-dim);
  opacity: 0;
}
.tab.file:hover .tab-close,
.tab.file.active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--bg-hover);
  color: var(--text-bright);
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
