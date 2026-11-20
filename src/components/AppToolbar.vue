<script setup lang="ts">
import { FolderOpen } from 'lucide-vue-next';
import { useProjectStore } from '../stores/project';

const project = useProjectStore();
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
.spacer {
  flex: 1;
}
.toolbar :deep(.divider) {
  width: 1px;
  height: 20px;
  background: var(--border);
}
</style>
