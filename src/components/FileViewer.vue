<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ExternalLink, Lock } from 'lucide-vue-next';
import { api } from '../api';
import { useProjectStore } from '../stores/project';
import { useToastsStore } from '../stores/toasts';
import type { FileTab } from '../stores/viewer';
import { relativeTo } from '../utils/paths';
import VirtualList from './VirtualList.vue';

const props = defineProps<{ tab: FileTab }>();

const project = useProjectStore();
const toasts = useToastsStore();

const LINE_HEIGHT = 19;
const list = ref<{ scrollToTop: () => void } | null>(null);

const relativePath = computed(() =>
  project.path ? relativeTo(props.tab.path, project.path, project.sep) : props.tab.path,
);
/** Wide enough for the largest line number. */
const gutterWidth = computed(() => `${String(props.tab.lines.length).length + 2}ch`);

const sizeText = computed(() => {
  const size = props.tab.size;
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
});

// Another file shown in the same (preview) tab starts from its first line.
watch(
  () => props.tab.path,
  () => list.value?.scrollToTop(),
);

async function openExternally() {
  if (!project.path) return;
  try {
    await api.openInSystem(project.path, props.tab.path);
  } catch (e) {
    toasts.error(e, 'Открыть в системе');
  }
}
</script>

<template>
  <div class="viewer">
    <div class="viewer-bar">
      <span class="ellipsis path" :title="tab.path">{{ relativePath }}</span>
      <span class="readonly" title="StudioLite не редактирует файлы">
        <Lock :size="11" /> только чтение
      </span>
      <span class="spacer" />
      <span v-if="!tab.loading && !tab.error" class="meta">
        <template v-if="!tab.binary">{{ tab.lines.length.toLocaleString('ru-RU') }} строк · </template>
        {{ sizeText }}
      </span>
      <button class="btn small icon" title="Открыть в программе по умолчанию" @click="openExternally">
        <ExternalLink :size="14" />
      </button>
    </div>
    <div v-if="tab.truncated" class="notice">
      Файл большой: показано только начало. Целиком откройте его во внешней программе.
    </div>
    <div class="viewer-body">
      <div v-if="tab.loading && !tab.lines.length" class="empty">Загрузка…</div>
      <div v-else-if="tab.error" class="empty error">{{ tab.error }}</div>
      <div v-else-if="tab.binary" class="empty">
        Это не текстовый файл — показать его нельзя.
        <button class="btn outlined" @click="openExternally">
          <ExternalLink :size="14" /> Открыть в системе
        </button>
      </div>
      <VirtualList
        v-else
        ref="list"
        :items="tab.lines"
        :row-height="LINE_HEIGHT"
        :overscan="20"
      >
        <template #default="{ item: html, index }">
          <div class="line">
            <span class="gutter" :style="{ width: gutterWidth }">{{ index + 1 }}</span>
            <!-- eslint-disable-next-line vue/no-v-html -- escaped by highlight.ts -->
            <span class="code hljs" v-html="html" />
          </div>
        </template>
      </VirtualList>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.viewer-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  height: 28px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11px;
}
.path {
  color: var(--text);
  font-size: 12px;
}
.readonly {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.spacer {
  flex: 1;
}
.meta {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.notice {
  flex: none;
  padding: 4px 12px;
  background: #3d3223;
  border-bottom: 1px solid var(--border);
  color: var(--yellow);
  font-size: 12px;
}
.viewer-body {
  flex: 1;
  min-height: 0;
}
.empty.error {
  color: var(--red);
}
.line {
  display: flex;
  height: 19px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 19px;
  white-space: pre;
}
.gutter {
  position: sticky;
  left: 0;
  flex: none;
  padding-right: 1ch;
  background: var(--bg);
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  text-align: right;
  user-select: none;
  -webkit-user-select: none;
}
.code {
  padding: 0 16px 0 12px;
  color: var(--text);
  tab-size: 4;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
</style>
