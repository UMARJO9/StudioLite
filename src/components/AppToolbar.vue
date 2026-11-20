<script setup lang="ts">
import { FolderOpen, GitBranch, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next';
import { useGitStore } from '../stores/git';
import BuildButton from './BuildButton.vue';
import DeviceSelector from './DeviceSelector.vue';
import PackageButton from './PackageButton.vue';
import TaskStatus from './TaskStatus.vue';
import { useProjectStore } from '../stores/project';

defineProps<{ sidebarCollapsed: boolean }>();
const emit = defineEmits<{ toggleSidebar: [] }>();

const project = useProjectStore();
const git = useGitStore();
</script>

<template>
  <header class="toolbar">
    <button
      class="btn icon"
      :disabled="!project.info"
      :title="
        sidebarCollapsed ? 'Показать боковую панель (⌘B / Ctrl+B)' : 'Скрыть боковую панель (⌘B / Ctrl+B)'
      "
      :aria-pressed="!sidebarCollapsed"
      @click="emit('toggleSidebar')"
    >
      <PanelLeftOpen v-if="sidebarCollapsed" :size="16" />
      <PanelLeftClose v-else :size="16" />
    </button>
    <button
      class="btn"
      :disabled="project.opening"
      title="Открыть папку Android-проекта"
      @click="project.pickAndOpen()"
    >
      <FolderOpen :size="16" />
      <span>Открыть проект</span>
    </button>
    <span v-if="project.info" class="project-name ellipsis" :title="project.info.path">
      {{ project.info.name }}
    </span>
    <span v-if="git.branch" class="branch" title="Текущая ветка">
      <GitBranch :size="14" />
      <span class="ellipsis">{{ git.branch }}</span>
    </span>
    <div class="divider" />
    <DeviceSelector />
    <BuildButton />
    <PackageButton />
    <div class="divider" />
    <TaskStatus class="task-status" />
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: var(--toolbar-height);
  padding: 0 8px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.project-name {
  max-width: 220px;
  color: var(--text-bright);
  font-weight: 600;
}
.branch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 240px;
  height: 24px;
  padding: 0 8px;
  background: var(--bg-input);
  border-radius: 12px;
  color: var(--text);
  font-size: 12px;
}
.task-status {
  flex: 1;
}
.divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
</style>
