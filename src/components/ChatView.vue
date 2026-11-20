<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ArrowUp, LoaderCircle, Square, Wrench } from 'lucide-vue-next';
import type { ChatAccess } from '../api';
import { useChatsStore, type Chat } from '../stores/chats';
import { renderMarkdown } from '../utils/markdown';

const props = defineProps<{ chat: Chat }>();

const chats = useChatsStore();

const draft = ref('');
const scroller = ref<HTMLElement | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);
/** Follow new messages unless the user has scrolled up to read. */
let follow = true;

const rt = computed(() => chats.runtimeOf(props.chat.id));
const streamingHtml = computed(() => (rt.value.streaming ? renderMarkdown(rt.value.streaming) : ''));
const canSend = computed(() => !rt.value.running && draft.value.trim().length > 0 && chats.isConfigured);

function onScroll() {
  const el = scroller.value;
  if (el) follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

async function scrollToBottom(force = false) {
  if (!follow && !force) return;
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(() => [props.chat.items.length, rt.value.streaming, rt.value.running], () => scrollToBottom());
watch(
  () => props.chat.id,
  () => {
    follow = true;
    draft.value = '';
    void scrollToBottom(true);
    input.value?.focus();
  },
);
onMounted(() => {
  void scrollToBottom(true);
  input.value?.focus();
});

function resizeInput() {
  const el = input.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function send() {
  if (!canSend.value) return;
  const text = draft.value;
  draft.value = '';
  follow = true;
  void chats.send(props.chat.id, text);
  void nextTick(resizeInput);
}

function onKeydown(e: KeyboardEvent) {
  // Enter sends, Shift+Enter makes a new line; don't send while an IME is composing.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

function onAccessChange(e: Event) {
  chats.setAccess(props.chat.id, (e.target as HTMLSelectElement).value as ChatAccess);
}
</script>

<template>
  <div class="chat">
    <div ref="scroller" class="messages" @scroll.passive="onScroll">
      <div v-if="!chat.items.length && !rt.running" class="empty">
        Напишите, что нужно сделать в проекте.
        <span class="dim">Чат работает в папке открытого проекта.</span>
      </div>

      <template v-for="item in chat.items" :key="item.id">
        <div v-if="item.kind === 'user'" class="msg user">{{ item.text }}</div>
        <!-- eslint-disable-next-line vue/no-v-html -- escaped by renderMarkdown -->
        <div v-else-if="item.kind === 'assistant'" class="msg answer md" v-html="renderMarkdown(item.text)" />
        <div v-else-if="item.kind === 'tool'" class="tool" :title="item.text">
          <Wrench :size="12" />
          <span class="tool-name">{{ item.tool }}</span>
          <span class="ellipsis tool-text">{{ item.text }}</span>
        </div>
        <div v-else class="note" :class="item.kind">{{ item.text }}</div>
      </template>

      <!-- eslint-disable-next-line vue/no-v-html -- escaped by renderMarkdown -->
      <div v-if="streamingHtml" class="msg answer md" v-html="streamingHtml" />
      <div v-if="rt.running" class="working">
        <LoaderCircle :size="14" class="spin" />
        {{ rt.stopping ? 'Останавливается…' : 'Работает…' }}
      </div>
    </div>

    <div class="composer">
      <textarea
        ref="input"
        v-model="draft"
        rows="1"
        :placeholder="
          chats.isConfigured
            ? 'Сообщение… (Enter — отправить, Shift+Enter — новая строка)'
            : 'Сначала укажите программу чата в панели «Чаты»'
        "
        :disabled="!chats.isConfigured"
        @input="resizeInput"
        @keydown="onKeydown"
      />
      <div class="composer-bar">
        <label class="access" title="Что чату разрешено делать в проекте">
          Доступ:
          <select :value="chat.access" :disabled="rt.running" @change="onAccessChange">
            <option value="readOnly">только чтение</option>
            <option value="editFiles">правка файлов</option>
          </select>
        </label>
        <span v-if="rt.costUsd !== null" class="cost" title="Стоимость последнего ответа">
          ${{ rt.costUsd.toFixed(3) }}
        </span>
        <span class="spacer" />
        <button
          v-if="rt.running"
          class="btn outlined stop"
          :disabled="rt.stopping"
          title="Остановить ответ"
          @click="chats.stop(chat.id)"
        >
          <Square :size="12" /> Стоп
        </button>
        <button v-else class="btn primary" :disabled="!canSend" title="Отправить (Enter)" @click="send">
          <ArrowUp :size="14" /> Отправить
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 16px max(16px, calc((100% - 820px) / 2));
  overflow-y: auto;
  user-select: text;
  -webkit-user-select: text;
}
.empty {
  flex: 1;
  height: auto;
  user-select: none;
  -webkit-user-select: none;
}
.dim {
  font-size: 12px;
}
.msg {
  max-width: 100%;
  line-height: 1.55;
  overflow-wrap: anywhere;
  cursor: text;
}
.msg.user {
  align-self: flex-end;
  max-width: 85%;
  padding: 8px 12px;
  background: var(--bg-active);
  border-radius: 12px 12px 2px 12px;
  color: var(--text-bright);
  white-space: pre-wrap;
}
.msg.answer {
  color: var(--text-bright);
}
.tool {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.tool svg {
  flex: none;
}
.tool-name {
  flex: none;
  color: var(--text);
}
.note {
  padding: 6px 10px;
  border-left: 3px solid var(--blue);
  background: var(--bg-panel);
  border-radius: 0 4px 4px 0;
  color: var(--text);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note.error {
  border-left-color: var(--red);
  color: var(--red);
}
.working {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
  user-select: none;
  -webkit-user-select: none;
}
.composer {
  flex: none;
  margin: 0 max(16px, calc((100% - 820px) / 2)) 14px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
}
.composer:focus-within {
  border-color: var(--accent);
}
textarea {
  display: block;
  width: 100%;
  max-height: 200px;
  padding: 4px 6px;
  resize: none;
  background: transparent;
  border: none;
  color: var(--text-bright);
  font: inherit;
  line-height: 1.5;
  outline: none;
}
.composer-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
.access select {
  height: 22px;
  margin-left: 2px;
  padding: 0 4px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text);
  font: inherit;
}
.cost {
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1;
}
.stop {
  color: var(--red);
}

/* Rendered markdown (v-html content is not reached by scoped selectors without :deep). */
.md :deep(p) {
  margin: 0 0 8px;
}
.md :deep(p:last-child) {
  margin-bottom: 0;
}
.md :deep(h3),
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  margin: 12px 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 0 0 8px;
  padding-left: 22px;
}
.md :deep(li) {
  margin: 2px 0;
}
.md :deep(code) {
  padding: 1px 4px;
  background: var(--bg-input);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.md :deep(.md-code) {
  margin: 0 0 8px;
  overflow: hidden;
  background: #17181a;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.md :deep(.md-lang) {
  padding: 2px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11px;
}
.md :deep(pre) {
  margin: 0;
  padding: 8px 10px;
  overflow-x: auto;
}
.md :deep(pre code) {
  padding: 0;
  background: none;
  color: var(--text);
  white-space: pre;
}
.md :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 3px solid var(--border-strong);
  color: var(--text);
}
.md :deep(hr) {
  margin: 10px 0;
  border: none;
  border-top: 1px solid var(--border);
}
.md :deep(.md-link) {
  color: var(--blue);
}
</style>
