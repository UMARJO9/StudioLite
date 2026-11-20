<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { ArrowDownToLine, Trash2 } from 'lucide-vue-next';
import { MAX_CONSOLE_LINES, useConsoleStore } from '../stores/console';
import VirtualList from './VirtualList.vue';

const output = useConsoleStore();

const LINE_HEIGHT = 18;
const list = ref<{ scrollToBottom: () => void } | null>(null);
/** Follow new output. Turns off when the user scrolls up, back on at the bottom. */
const follow = ref(true);

async function stickToBottom() {
  await nextTick();
  list.value?.scrollToBottom();
}

watch(
  () => output.lines,
  () => {
    if (follow.value) void stickToBottom();
  },
  { flush: 'post' },
);

function toggleFollow() {
  follow.value = !follow.value;
  if (follow.value) void stickToBottom();
}

function clear() {
  output.clear();
  follow.value = true;
}

onMounted(stickToBottom);
</script>

<template>
  <div class="console">
    <div class="console-toolbar">
      <span class="count">
        {{ output.lines.length.toLocaleString('ru-RU') }} строк
        <template v-if="output.lines.length >= MAX_CONSOLE_LINES">
          (показаны последние {{ MAX_CONSOLE_LINES.toLocaleString('ru-RU') }})
        </template>
      </span>
      <span class="spacer" />
      <button
        class="btn small icon"
        :class="{ on: follow }"
        :title="follow ? 'Автоскролл включён' : 'Автоскролл выключен'"
        :aria-pressed="follow"
        @click="toggleFollow"
      >
        <ArrowDownToLine :size="14" />
      </button>
      <button
        class="btn small icon"
        title="Очистить консоль"
        :disabled="!output.lines.length"
        @click="clear"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <div class="console-body">
      <div v-if="!output.lines.length" class="empty">
        Здесь появится вывод сборки. Нажмите Build или Run.
      </div>
      <VirtualList
        v-else
        ref="list"
        :items="output.lines"
        :row-height="LINE_HEIGHT"
        :overscan="20"
        :key-of="(line) => line.id"
        @scroll="(atBottom) => (follow = atBottom)"
      >
        <template #default="{ item: line }">
          <div class="line" :class="line.level">{{ line.text }}</div>
        </template>
      </VirtualList>
    </div>
  </div>
</template>

<style scoped>
.console {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.console-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 28px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11px;
}
.spacer {
  flex: 1;
}
.btn.on {
  background: var(--bg-active);
  color: var(--text-bright);
}
.console-body {
  flex: 1;
  min-height: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.console-body .empty {
  font-family: var(--font-ui);
  font-size: 13px;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
.line {
  height: 18px;
  padding: 0 12px;
  line-height: 18px;
  white-space: pre;
}
.line.error {
  background: rgb(247 84 100 / 10%);
  color: var(--red);
}
.line.warning {
  color: var(--yellow);
}
.line.info {
  color: var(--blue);
}
.line.success {
  color: var(--green);
}
</style>
