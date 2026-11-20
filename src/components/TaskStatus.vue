<script setup lang="ts">
import { computed } from 'vue';
import { Ban, CircleCheck, CircleX, LoaderCircle } from 'lucide-vue-next';
import { TASK_TITLE, useTasksStore, type TaskOutcome } from '../stores/tasks';
import { formatDuration } from '../utils/time';

const tasks = useTasksStore();

const OUTCOME_TEXT: Record<TaskOutcome, string> = {
  success: 'успешно',
  failed: 'ошибка',
  cancelled: 'остановлено',
  error: 'не удалось выполнить',
};

const runningText = computed(() => {
  const task = tasks.running;
  if (!task) return '';
  const what = tasks.stopping ? 'остановка…' : tasks.stage || 'запуск…';
  return `${TASK_TITLE[task.kind]}: ${what}`;
});

const elapsed = computed(() => `${Math.floor(tasks.elapsedMs / 1000)} с`);
</script>

<template>
  <div class="status" role="status" aria-live="polite">
    <template v-if="tasks.running">
      <LoaderCircle :size="15" class="spin" />
      <span class="ellipsis text" :title="runningText">{{ runningText }}</span>
      <span class="time">{{ elapsed }}</span>
    </template>
    <template v-else-if="tasks.last">
      <CircleCheck v-if="tasks.last.outcome === 'success'" :size="15" class="success" />
      <Ban v-else-if="tasks.last.outcome === 'cancelled'" :size="15" class="cancelled" />
      <CircleX v-else :size="15" class="failed" />
      <span class="ellipsis text" :class="tasks.last.outcome">
        {{ TASK_TITLE[tasks.last.kind] }}: {{ OUTCOME_TEXT[tasks.last.outcome] }}
      </span>
      <span class="time">{{ formatDuration(tasks.last.durationMs) }}</span>
    </template>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
}
.status svg {
  flex: none;
}
.text {
  min-width: 0;
}
.time {
  flex: none;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.success {
  color: var(--green);
}
.failed,
.error {
  color: var(--red);
}
.cancelled {
  color: var(--yellow);
}
</style>
