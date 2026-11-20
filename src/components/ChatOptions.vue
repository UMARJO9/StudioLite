<script setup lang="ts">
// The two pills under the chat input: model + effort, and what the chat may do on its own.
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { Check, Eye, FilePen, ListChecks, Zap } from 'lucide-vue-next';
import type { ChatAccess, ChatEffort } from '../api';
import { useChatsStore, type Chat } from '../stores/chats';

const props = defineProps<{ chat: Chat; disabled: boolean }>();

const chats = useChatsStore();

const EFFORTS: { id: ChatEffort; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' },
];

const ACCESS: { id: ChatAccess; label: string; hint: string; icon: Component }[] = [
  {
    id: 'readOnly',
    label: 'Только чтение',
    hint: 'Читает и ищет по проекту. Правки и команды отклоняются',
    icon: Eye,
  },
  {
    id: 'plan',
    label: 'План',
    hint: 'Изучает проект и предлагает план, ничего не меняя',
    icon: ListChecks,
  },
  {
    id: 'editFiles',
    label: 'Правка файлов',
    hint: 'Создаёт и изменяет файлы проекта без подтверждения',
    icon: FilePen,
  },
  {
    id: 'auto',
    label: 'Авто',
    hint: 'Сам решает, что безопасно: правит файлы и запускает команды',
    icon: Zap,
  },
];

const open = ref<'model' | 'access' | null>(null);
const root = ref<HTMLElement | null>(null);

const modelOptions = computed(() => [
  { id: null as string | null, label: 'По умолчанию', hint: 'Модель, выбранная в самой программе' },
  ...chats.models,
]);
const currentModel = computed(
  () =>
    modelOptions.value.find((m) => m.id === props.chat.model) ?? {
      id: props.chat.model,
      label: props.chat.model ?? 'По умолчанию',
      hint: '',
    },
);
const effortIndex = computed(() =>
  Math.max(
    0,
    EFFORTS.findIndex((e) => e.id === props.chat.effort),
  ),
);
const currentAccess = computed(() => ACCESS.find((a) => a.id === props.chat.access) ?? ACCESS[0]);

function toggle(which: 'model' | 'access') {
  open.value = open.value === which ? null : which;
}
function pickModel(id: string | null) {
  chats.update(props.chat.id, { model: id });
  open.value = null;
}
function pickAccess(id: ChatAccess) {
  chats.update(props.chat.id, { access: id });
  open.value = null;
}
function setEffort(index: number) {
  chats.update(props.chat.id, { effort: EFFORTS[index].id });
}

function onPointerDown(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = null;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = null;
}
function close() {
  open.value = null;
}
function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('pointerdown', onPointerDown as EventListener, true);
  window[method]('keydown', onKey as EventListener);
  window[method]('blur', close);
}
watch(
  () => open.value !== null,
  (isOpen) => listen(isOpen),
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = null;
  },
);
onBeforeUnmount(() => listen(false));
</script>

<template>
  <div ref="root" class="options">
    <button
      class="pill"
      :class="{ on: open === 'model' }"
      :disabled="disabled"
      title="Модель и уровень усилий"
      aria-haspopup="listbox"
      :aria-expanded="open === 'model'"
      @click="toggle('model')"
    >
      <span class="ellipsis">{{ currentModel.label }}</span>
      <span class="pill-dim">{{ EFFORTS[effortIndex].label }}</span>
    </button>

    <button
      class="pill"
      :class="{ on: open === 'access' }"
      :disabled="disabled"
      title="Что чату разрешено делать в проекте"
      aria-haspopup="listbox"
      :aria-expanded="open === 'access'"
      @click="toggle('access')"
    >
      <component :is="currentAccess.icon" :size="13" />
      <span>{{ currentAccess.label }}</span>
    </button>

    <div v-if="open === 'model'" class="popup" role="listbox">
      <div class="popup-title">Выбор модели</div>
      <button
        v-for="model in modelOptions"
        :key="model.id ?? ''"
        class="option"
        :class="{ selected: model.id === chat.model }"
        role="option"
        :aria-selected="model.id === chat.model"
        @click="pickModel(model.id)"
      >
        <span class="option-text">
          <span class="option-label">{{ model.label }}</span>
          <span v-if="model.hint" class="option-hint">{{ model.hint }}</span>
        </span>
        <Check v-if="model.id === chat.model" :size="15" class="check" />
      </button>
      <p v-if="!chats.models.length" class="popup-note">
        Список моделей пуст. Добавьте их в настройках панели «Чаты» (шестерёнка).
      </p>
      <div class="effort">
        <span>
          Усилие <span class="pill-dim">({{ EFFORTS[effortIndex].label }})</span>
        </span>
        <div class="dots" role="radiogroup" aria-label="Уровень усилий">
          <button
            v-for="(effort, i) in EFFORTS"
            :key="effort.id"
            class="dot"
            :class="{ current: i === effortIndex }"
            role="radio"
            :aria-checked="i === effortIndex"
            :title="effort.label"
            @click="setEffort(i)"
          />
        </div>
      </div>
    </div>

    <div v-if="open === 'access'" class="popup" role="listbox">
      <div class="popup-title">Разрешения</div>
      <button
        v-for="access in ACCESS"
        :key="access.id"
        class="option"
        :class="{ selected: access.id === chat.access }"
        role="option"
        :aria-selected="access.id === chat.access"
        @click="pickAccess(access.id)"
      >
        <component :is="access.icon" :size="15" class="option-icon" />
        <span class="option-text">
          <span class="option-label">{{ access.label }}</span>
          <span class="option-hint">{{ access.hint }}</span>
        </span>
        <Check v-if="access.id === chat.access" :size="15" class="check" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.options {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 24px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 12px;
  color: var(--text-bright);
  font-size: 12px;
  white-space: nowrap;
}
.pill:hover:not(:disabled),
.pill.on {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.pill:disabled {
  opacity: 0.5;
}
.pill:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
.pill-dim {
  color: var(--text-dim);
}
.popup {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 700;
  width: min(420px, calc(100vw - 48px));
  max-height: min(520px, calc(100vh - 220px));
  padding: 6px;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgb(0 0 0 / 55%);
}
.popup-title {
  padding: 6px 10px 4px;
  color: var(--text-dim);
  font-size: 12px;
}
.popup-note {
  margin: 4px 10px 8px;
  color: var(--text-dim);
  font-size: 11.5px;
}
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
}
.option:hover {
  background: var(--bg-hover);
}
.option.selected {
  background: var(--bg-input);
}
.option-icon {
  flex: none;
  color: var(--text-dim);
}
.option-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.option-label {
  color: var(--text-bright);
  font-size: 13px;
}
.option-hint {
  color: var(--text-dim);
  font-size: 11.5px;
}
.check {
  flex: none;
  color: var(--text-bright);
}
.effort {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-bright);
  font-size: 13px;
}
.dots {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: var(--bg-input);
  border-radius: 12px;
}
.dot {
  position: relative;
  width: 20px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
}
.dot::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  transform: translate(-50%, -50%);
  background: var(--text-dim);
  border-radius: 50%;
}
.dot:hover::after {
  background: var(--text-bright);
}
.dot.current::after {
  width: 14px;
  height: 14px;
  background: var(--text-bright);
}
.dot:focus-visible {
  outline: 1px solid var(--accent);
  border-radius: 9px;
}
</style>
