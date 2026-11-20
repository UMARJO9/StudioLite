<script setup lang="ts">
import { FolderOpen, GitBranch } from 'lucide-vue-next';
import { useGitStore } from '../stores/git';
import DeviceSelector from './DeviceSelector.vue';
import { useProjectStore } from '../stores/project';

const project = useProjectStore();
const git = useGitStore();
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
    <div class="spacer" />
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
.spacer {
  flex: 1;
}
.divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
</style>
