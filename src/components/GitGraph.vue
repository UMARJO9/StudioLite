<script setup lang="ts">
import { computed } from 'vue';
import { GitBranch, RefreshCw, Tag } from 'lucide-vue-next';
import type { Commit } from '../api';
import { useGitStore } from '../stores/git';
import { useProjectStore } from '../stores/project';
import { layoutGraph, type GraphEdge, type GraphRow } from '../utils/gitGraph';
import { parseRefs, type RefBadge } from '../utils/gitRefs';
import { formatDateTime, formatRelative } from '../utils/time';
import VirtualList from './VirtualList.vue';

const emit = defineEmits<{ refresh: [] }>();

const git = useGitStore();
const project = useProjectStore();

const ROW_HEIGHT = 24;
const LANE_WIDTH = 12;
const GRAPH_PADDING = 8;
/** Lanes beyond this are clipped so a wide history can't push the text out of view. */
const MAX_VISIBLE_LANES = 12;
const PALETTE = [
  '#56a8f5',
  '#6aab73',
  '#e0c46c',
  '#c77dbb',
  '#e08855',
  '#4fc1c9',
  '#f75464',
  '#a9b837',
];

interface Row {
  commit: Commit;
  graph: GraphRow;
  refs: RefBadge[];
  date: string;
  tooltip: string;
  paths: { d: string; color: string }[];
  cx: number;
  color: string;
}

const laneX = (lane: number) => GRAPH_PADDING + lane * LANE_WIDTH;
const colorOf = (index: number) => PALETTE[index % PALETTE.length];

function edgePath(edge: GraphEdge, half: 'top' | 'bottom'): string {
  const mid = ROW_HEIGHT / 2;
  const [y1, y2] = half === 'top' ? [0, mid] : [mid, ROW_HEIGHT];
  const x1 = laneX(edge.from);
  const x2 = laneX(edge.to);
  if (x1 === x2) return `M${x1},${y1}V${y2}`;
  const yc = (y1 + y2) / 2;
  return `M${x1},${y1}C${x1},${yc} ${x2},${yc} ${x2},${y2}`;
}

const layout = computed(() => layoutGraph(git.commits));

const graphWidth = computed(
  () =>
    GRAPH_PADDING * 2 +
    (Math.min(Math.max(layout.value.laneCount, 1), MAX_VISIBLE_LANES) - 1) * LANE_WIDTH,
);

const rows = computed<Row[]>(() => {
  const now = Date.now() / 1000;
  return git.commits.map((commit, i) => {
    const graph = layout.value.rows[i];
    const message = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
    return {
      commit,
      graph,
      refs: parseRefs(commit.refs),
      date: formatRelative(commit.timestamp, now),
      tooltip: `${commit.hash}\n${commit.author}, ${formatDateTime(commit.timestamp)}\n\n${message}`,
      paths: [
        ...graph.top.map((e) => ({ d: edgePath(e, 'top'), color: colorOf(e.color) })),
        ...graph.bottom.map((e) => ({ d: edgePath(e, 'bottom'), color: colorOf(e.color) })),
      ],
      cx: laneX(graph.lane),
      color: colorOf(graph.color),
    };
  });
});

const emptyText = computed(() => {
  const info = project.info;
  if (!info) return '';
  if (!info.gitAvailable) return 'git не найден в PATH';
  if (!info.isGitRepo) return 'Папка не является git-репозиторием';
  if (git.logLoading) return 'Загрузка…';
  return 'В репозитории пока нет коммитов';
});
</script>

<template>
  <div class="git-graph">
    <div class="panel-header">
      <span>Git</span>
      <span v-if="rows.length" class="count">{{ rows.length }}{{ git.hasMore ? '+' : '' }}</span>
      <span class="spacer" />
      <button class="btn small icon" title="Обновить" @click="emit('refresh')">
        <RefreshCw :size="13" :class="{ spin: git.logLoading }" />
      </button>
    </div>
    <div class="graph-body">
      <div v-if="!rows.length" class="empty">{{ emptyText }}</div>
      <VirtualList
        v-else
        fit
        :items="rows"
        :row-height="ROW_HEIGHT"
        :key-of="(row) => row.commit.hash"
      >
        <template #default="{ item: row }">
          <div class="row" :title="row.tooltip">
            <svg
              class="lanes"
              :width="graphWidth"
              :height="ROW_HEIGHT"
              :viewBox="`0 0 ${graphWidth} ${ROW_HEIGHT}`"
              aria-hidden="true"
            >
              <path
                v-for="(p, i) in row.paths"
                :key="i"
                :d="p.d"
                :stroke="p.color"
                fill="none"
                stroke-width="1.6"
              />
              <circle
                :cx="row.cx"
                :cy="ROW_HEIGHT / 2"
                r="3.6"
                :fill="row.commit.parents.length > 1 ? 'var(--bg-panel)' : row.color"
                :stroke="row.color"
                stroke-width="1.6"
              />
            </svg>
            <span
              v-for="badge in row.refs"
              :key="badge.kind + badge.name"
              class="badge"
              :class="[badge.kind, { current: badge.current }]"
            >
              <Tag v-if="badge.kind === 'tag'" :size="10" />
              <GitBranch v-else-if="badge.kind !== 'head'" :size="10" />
              {{ badge.name }}
            </span>
            <span class="subject ellipsis">{{ row.commit.subject }}</span>
            <span class="author ellipsis">{{ row.commit.author }}</span>
            <span class="date">{{ row.date }}</span>
          </div>
        </template>
        <template #footer>
          <div v-if="git.hasMore" class="more">
            <button class="btn small outlined" :disabled="git.logLoading" @click="git.loadMore()">
              {{ git.logLoading ? 'Загрузка…' : 'Загрузить ещё' }}
            </button>
          </div>
        </template>
      </VirtualList>
    </div>
  </div>
</template>

<style scoped>
.git-graph {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  container-type: inline-size;
}
.count {
  font-weight: 400;
  letter-spacing: 0;
}
.graph-body {
  flex: 1;
  min-height: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding-right: 10px;
  font-size: 12px;
}
.row:hover {
  background: var(--bg-hover);
}
.lanes {
  flex: none;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 1 auto;
  min-width: 28px;
  max-width: 130px;
  height: 16px;
  padding: 0 5px;
  overflow: hidden;
  border: 1px solid;
  border-radius: 3px;
  font-size: 10.5px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge svg {
  flex: none;
}
.badge.branch {
  border-color: #3f6b46;
  background: #26392a;
  color: #8fd19a;
}
.badge.branch.current {
  border-color: var(--green);
  font-weight: 600;
}
.badge.remote {
  border-color: #5a4a78;
  background: #2f2a3d;
  color: #b9a3e3;
}
.badge.tag {
  border-color: #6e6032;
  background: #3a3423;
  color: var(--yellow);
}
.badge.head {
  border-color: var(--accent);
  background: #25324d;
  color: #8fb4ff;
  font-weight: 600;
}
.badge.other {
  border-color: var(--border-strong);
  color: var(--text-dim);
}
.subject {
  flex: 1 1 0;
  min-width: 40px;
  color: var(--text-bright);
}
.author {
  flex: 0 1 auto;
  max-width: 110px;
  color: var(--text-dim);
}
.date {
  flex: none;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.more {
  display: flex;
  justify-content: center;
  padding: 8px;
}
@container (max-width: 420px) {
  .author {
    display: none;
  }
}
</style>
