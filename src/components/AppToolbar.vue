<script setup lang="ts">
import { Asterisk, FolderOpen, GitBranch } from 'lucide-vue-next';
import { useChatsStore } from '../stores/chats';
import { useGitStore } from '../stores/git';
import BuildButton from './BuildButton.vue';
import DeviceSelector from './DeviceSelector.vue';
import PackageButton from './PackageButton.vue';
import TaskStatus from './TaskStatus.vue';
import { useProjectStore } from '../stores/project';

const project = useProjectStore();
const git = useGitStore();
const chats = useChatsStore();
</script>

<template>
  <header class="toolbar">
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
    <button
      class="btn icon chat-button"
      :disabled="!project.info"
      :title="project.info ? 'Новый чат' : 'Сначала откройте проект'"
      aria-label="Новый чат"
      @click="chats.openNew()"
    >
      <Asterisk :size="20" :stroke-width="2.6" />
    </button>
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
.chat-button:not(:disabled) {
  color: #d97757;
}
.chat-button:hover:not(:disabled) {
  color: #e8926f;
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
