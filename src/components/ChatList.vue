<script setup lang="ts">
// Sidebar section: the project's chats and the settings they need.
import { ref, watch } from 'vue';
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  Plus,
  Settings,
  X,
} from 'lucide-vue-next';
import { chatTabId, useChatsStore } from '../stores/chats';
import { useViewerStore } from '../stores/viewer';
import { formatRelative } from '../utils/time';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const chats = useChatsStore();
const viewer = useViewerStore();

const showSettings = ref(false);
const commandInput = ref(chats.command);
const checking = ref(false);

// The model list is edited as plain text: one model per line, `id | name | description`.
const formatModels = () =>
  chats.models.map((m) => [m.id, m.label, m.hint].filter(Boolean).join(' | ')).join('\n');
const modelsInput = ref(formatModels());
watch(() => chats.models, () => (modelsInput.value = formatModels()));

function saveModels() {
  const list = modelsInput.value
    .split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter(([id]) => id)
    .map(([id, label, hint]) => ({ id, label: label || id, hint: hint ?? '' }));
  chats.setModels(list);
}

watch(
  () => chats.command,
  (value) => (commandInput.value = value),
);

async function saveCommand() {
  checking.value = true;
  try {
    saveModels();
    const ok = await chats.setCommand(commandInput.value, { notify: true });
    if (ok) showSettings.value = false;
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="chat-list" :class="{ collapsed }">
    <div
      class="panel-header toggle"
      :title="collapsed ? 'Развернуть раздел' : 'Свернуть раздел'"
      @click="emit('toggle')"
    >
      <button class="btn small icon" :aria-expanded="!collapsed" aria-label="Свернуть или развернуть раздел">
        <ChevronRight v-if="collapsed" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
      <span>Чаты</span>
      <span v-if="chats.sorted.length" class="count">{{ chats.sorted.length }}</span>
      <span class="spacer" />
      <template v-if="!collapsed">
        <button
          class="btn small icon"
          :class="{ on: showSettings }"
          title="Программа чата и модели"
          @click.stop="showSettings = !showSettings"
        >
          <Settings :size="13" />
        </button>
        <button
          class="btn small icon"
          title="Новый чат"
          :disabled="!chats.isConfigured"
          @click.stop="chats.create()"
        >
          <Plus :size="15" />
        </button>
      </template>
    </div>

    <div v-show="!collapsed" class="chat-body">
    <form v-if="showSettings || !chats.isConfigured" class="setup" @submit.prevent="saveCommand">
      <label for="chat-command">Программа чата</label>
      <p class="hint">
        Имя или полный путь консольной программы-агента, установленной на этом компьютере.
        Хранится только в локальных настройках.
      </p>
      <div class="setup-row">
        <input
          id="chat-command"
          v-model="commandInput"
          type="text"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          placeholder="имя программы или /полный/путь"
        />
        <button class="btn primary small" type="submit" :disabled="checking || !commandInput.trim()">
          {{ checking ? '…' : 'Сохранить' }}
        </button>
      </div>
      <label for="chat-models" class="second">Модели для выбора</label>
      <p class="hint">
        По одной в строке: <code>идентификатор | название | пояснение</code>. Пустой список —
        используется модель программы по умолчанию.
      </p>
      <textarea
        id="chat-models"
        v-model="modelsInput"
        rows="5"
        spellcheck="false"
        autocapitalize="off"
        placeholder="идентификатор | название | пояснение"
      />
      <p v-if="chats.commandError" class="status error">{{ chats.commandError }}</p>
      <p v-else-if="chats.commandPath" class="status ok">Найдена: {{ chats.commandPath }}</p>
    </form>

    <div class="list">
      <div v-if="!chats.sorted.length" class="empty">
        <MessageSquare :size="22" />
        <span v-if="chats.isConfigured">Чатов пока нет.</span>
        <span v-else>Укажите программу чата, чтобы начать.</span>
        <button v-if="chats.isConfigured" class="btn outlined" @click="chats.create()">
          <Plus :size="14" /> Новый чат
        </button>
      </div>
      <div
        v-for="chat in chats.sorted"
        :key="chat.id"
        class="item"
        :class="{ active: viewer.active === chatTabId(chat.id) }"
        :title="chat.title"
        @click="chats.openTab(chat.id)"
      >
        <LoaderCircle v-if="chats.runtimeOf(chat.id).running" :size="14" class="spin icon" />
        <MessageSquare v-else :size="14" class="icon" />
        <div class="item-text">
          <div class="ellipsis title">{{ chat.title }}</div>
          <div class="time">{{ formatRelative(chat.updatedAt / 1000) }}</div>
        </div>
        <button
          class="btn small icon remove"
          title="Убрать из списка"
          @click.stop="chats.remove(chat.id)"
        >
          <X :size="13" />
        </button>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.chat-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.chat-list.collapsed {
  height: auto;
}
.chat-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.count {
  font-weight: 400;
  letter-spacing: 0;
}
.btn.on {
  background: var(--bg-active);
  color: var(--text-bright);
}
.setup {
  flex: none;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
.setup label {
  color: var(--text-bright);
  font-weight: 600;
}
.hint {
  margin: 4px 0 8px;
  color: var(--text-dim);
  font-size: 11px;
}
.setup-row {
  display: flex;
  gap: 6px;
}
.setup input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-bright);
  font: inherit;
  font-family: var(--font-mono);
  font-size: 12px;
}
.setup textarea {
  display: block;
  width: 100%;
  padding: 6px 8px;
  resize: vertical;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-bright);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre;
}
.setup textarea:focus {
  border-color: var(--accent);
  outline: none;
}
.setup label.second {
  display: block;
  margin-top: 12px;
}
.hint code {
  font-family: var(--font-mono);
}
.setup input:focus {
  border-color: var(--accent);
  outline: none;
}
.status {
  margin: 8px 0 0;
  font-size: 11px;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}
.status.error {
  color: var(--orange);
}
.status.ok {
  color: var(--green);
}
.list {
  flex: 1;
}
.list .empty {
  height: auto;
  padding: 14px;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 10px;
}
.item:hover {
  background: var(--bg-hover);
}
.item.active {
  background: var(--bg-active);
}
.icon {
  flex: none;
  color: var(--text-dim);
}
.item-text {
  flex: 1;
  min-width: 0;
}
.title {
  color: var(--text-bright);
}
.time {
  color: var(--text-dim);
  font-size: 11px;
}
.remove {
  opacity: 0;
}
.item:hover .remove,
.remove:focus-visible {
  opacity: 1;
}
</style>
