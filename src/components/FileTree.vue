<script setup lang="ts">
import { ref } from 'vue';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  FolderSearch,
  RefreshCw,
} from 'lucide-vue-next';
import { api, type FileEntry } from '../api';
import { useGitStore } from '../stores/git';
import { useProjectStore } from '../stores/project';
import { useToastsStore } from '../stores/toasts';
import { useTreeStore, type TreeRow } from '../stores/tree';
import { useViewerStore } from '../stores/viewer';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import VirtualList from './VirtualList.vue';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ refresh: []; toggle: [] }>();

const project = useProjectStore();
const tree = useTreeStore();
const git = useGitStore();
const toasts = useToastsStore();
const viewer = useViewerStore();

const ROW_HEIGHT = 22;
const INDENT = 14;

const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

/** Single click previews a file, double click keeps its tab open. */
function onFileOpen(entry: FileEntry, pin: boolean) {
  viewer.open(entry, { pin });
}

function onClick(row: TreeRow) {
  tree.selected = row.entry.path;
  if (row.entry.isDir) void tree.toggle(row.entry);
  else onFileOpen(row.entry, false);
}

function onDoubleClick(row: TreeRow) {
  if (!row.entry.isDir) onFileOpen(row.entry, true);
}

async function guarded(action: () => Promise<void>, what: string) {
  try {
    await action();
  } catch (e) {
    toasts.error(e, what);
  }
}

function onContextMenu(e: MouseEvent, entry: FileEntry) {
  const root = project.path;
  if (!root) return;
  tree.selected = entry.path;
  menu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [
      {
        label: 'Открыть в системе',
        icon: ExternalLink,
        action: () => guarded(() => api.openInSystem(root, entry.path), 'Открыть в системе'),
      },
      {
        label: 'Показать в проводнике',
        icon: FolderSearch,
        action: () =>
          guarded(() => api.revealInFileManager(root, entry.path), 'Показать в проводнике'),
      },
      {
        label: 'Копировать путь',
        icon: Copy,
        action: () =>
          guarded(async () => {
            await navigator.clipboard.writeText(entry.path);
            toasts.info('Путь скопирован');
          }, 'Копировать путь'),
      },
    ],
  };
}
</script>

<template>
  <div class="file-tree" :class="{ collapsed }">
    <div
      class="panel-header toggle"
      :title="collapsed ? 'Развернуть раздел' : 'Свернуть раздел'"
      @click="emit('toggle')"
    >
      <button class="btn small icon" :aria-expanded="!collapsed" aria-label="Свернуть или развернуть раздел">
        <ChevronRight v-if="collapsed" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
      <span class="ellipsis">Проект</span>
      <span class="spacer" />
      <template v-if="!collapsed">
        <button class="btn small icon" title="Свернуть все папки" @click.stop="tree.collapseAll()">
          <ChevronsDownUp :size="14" />
        </button>
        <button class="btn small icon" title="Обновить" @click.stop="emit('refresh')">
          <RefreshCw :size="13" :class="{ spin: tree.loading }" />
        </button>
      </template>
    </div>
    <div v-show="!collapsed" class="tree-body">
      <div v-if="!tree.rows.length" class="empty">
        {{ tree.loading ? 'Загрузка…' : 'Папка пуста' }}
      </div>
      <VirtualList
        v-else
        :items="tree.rows"
        :row-height="ROW_HEIGHT"
        :key-of="(row) => row.entry.path"
      >
        <template #default="{ item: row }">
          <div
            class="row"
            :class="[
              git.statusOf(row.entry.path) ?? 'clean',
              { selected: tree.selected === row.entry.path },
            ]"
            :style="{ paddingLeft: 6 + row.depth * INDENT + 'px' }"
            :title="row.entry.path"
            @click="onClick(row)"
            @dblclick="onDoubleClick(row)"
            @contextmenu.prevent="onContextMenu($event, row.entry)"
          >
            <span class="chevron">
              <template v-if="row.entry.isDir">
                <ChevronDown v-if="row.expanded" :size="14" />
                <ChevronRight v-else :size="14" />
              </template>
            </span>
            <FolderOpen v-if="row.entry.isDir && row.expanded" :size="14" class="icon folder" />
            <Folder v-else-if="row.entry.isDir" :size="14" class="icon folder" />
            <File v-else :size="14" class="icon" />
            <span class="name">{{ row.entry.name }}</span>
          </div>
        </template>
      </VirtualList>
    </div>
    <ContextMenu v-if="menu" v-bind="menu" @close="menu = null" />
  </div>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.file-tree.collapsed {
  height: auto;
}
.tree-body {
  flex: 1;
  min-height: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
  padding-right: 12px;
  white-space: nowrap;
}
.row:hover {
  background: var(--bg-hover);
}
.row.selected {
  background: var(--bg-active);
}
.chevron {
  display: inline-flex;
  flex: none;
  width: 14px;
  color: var(--text-dim);
}
.icon {
  flex: none;
  color: var(--text-dim);
}
.icon.folder {
  color: #8a9199;
}
.row.modified .name {
  color: var(--git-modified);
}
.row.added .name,
.row.untracked .name {
  color: var(--git-added);
}
.row.deleted .name {
  color: var(--git-deleted);
  text-decoration: line-through;
}
.row.conflict .name {
  color: var(--git-conflict);
}
</style>
