import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { LazyStore } from '@tauri-apps/plugin-store';
import { api, type ChatAccess, type TaskEvent } from '../api';
import { interpretChatLine, type ChatItemData, type ChatUpdate } from '../utils/chatProtocol';
import { errorMessage } from '../utils/errors';
import { loadSetting, saveSetting } from '../utils/persist';
import { useGitStore } from './git';
import { useProjectStore } from './project';
import { useToastsStore } from './toasts';
import { useTreeStore } from './tree';
import { BUILD_TAB, useViewerStore } from './viewer';

export interface ChatItem extends ChatItemData {
  id: number;
}

export interface Chat {
  id: string;
  title: string;
  /** Session reported by the CLI; passing it back continues the conversation. */
  sessionId: string | null;
  access: ChatAccess;
  createdAt: number;
  updatedAt: number;
  items: ChatItem[];
}

/** State that only exists while the app runs. */
interface ChatRuntime {
  running: boolean;
  stopping: boolean;
  /** Text of the answer being received right now. */
  streaming: string;
}

const NEW_CHAT_TITLE = 'Новый чат';
const MAX_TITLE_LENGTH = 60;
const MAX_STORED_CHATS = 100;
const MAX_STORED_ITEMS = 400;
const TAB_PREFIX = 'chat:';

/** Chats are kept per project in their own file, apart from the small settings file. */
const storage = new LazyStore('chats.json');

export const chatTabId = (chatId: string) => TAB_PREFIX + chatId;

export const useChatsStore = defineStore('chats', () => {
  const project = useProjectStore();
  const viewer = useViewerStore();
  const toasts = useToastsStore();

  const chats = ref<Chat[]>([]);
  const runtime = reactive<Record<string, ChatRuntime>>({});
  /** Chats shown as tabs, in tab order. */
  const openIds = ref<string[]>([]);
  let nextItemId = 1;
  let loadedFor: string | null = null;

  /** Name or path of the chat program (a local setting), and where it was found. */
  const command = ref('');
  const commandPath = ref<string | null>(null);
  const commandError = ref<string | null>(null);

  const sorted = computed(() => [...chats.value].sort((a, b) => b.updatedAt - a.updatedAt));
  const openChats = computed(() =>
    openIds.value.map((id) => chats.value.find((c) => c.id === id)).filter((c): c is Chat => !!c),
  );
  const activeChat = computed(() =>
    viewer.active.startsWith(TAB_PREFIX)
      ? (chats.value.find((c) => chatTabId(c.id) === viewer.active) ?? null)
      : null,
  );
  const isConfigured = computed(() => commandPath.value !== null);

  function runtimeOf(id: string): ChatRuntime {
    runtime[id] ??= { running: false, stopping: false, streaming: '' };
    return runtime[id];
  }

  // --- persistence ----------------------------------------------------------

  function save() {
    const path = loadedFor;
    if (!path) return;
    const data = sorted.value
      .slice(0, MAX_STORED_CHATS)
      // An untouched "new chat" is not worth keeping.
      .filter((chat) => chat.items.length > 0)
      .map((chat) => ({ ...chat, items: chat.items.slice(-MAX_STORED_ITEMS) }));
    storage.set(path, data).catch((e) => console.warn('chats: save failed', e));
  }

  async function loadFor(projectPath: string | null): Promise<void> {
    // Answers still arriving belong to the previous project; stop them.
    for (const chat of chats.value) {
      if (runtime[chat.id]?.running) void api.chatStop(chat.id).catch(() => undefined);
    }
    chats.value = [];
    openIds.value = [];
    loadedFor = projectPath;
    if (!projectPath) return;
    try {
      const stored = (await storage.get<Chat[]>(projectPath)) ?? [];
      if (loadedFor !== projectPath) return;
      chats.value = stored;
      nextItemId = 1 + Math.max(0, ...stored.flatMap((chat) => chat.items.map((i) => i.id)));
    } catch (e) {
      toasts.error(e, 'Чаты');
    }
  }

  // --- chat program ---------------------------------------------------------

  async function setCommand(value: string, opts: { notify?: boolean } = {}): Promise<boolean> {
    command.value = value.trim();
    saveSetting('chatCommand', command.value);
    if (!command.value) {
      commandPath.value = null;
      commandError.value = null;
      return false;
    }
    try {
      commandPath.value = await api.chatCheck(command.value);
      commandError.value = null;
      if (opts.notify) toasts.success(`Программа чата найдена: ${commandPath.value}`);
      return true;
    } catch (e) {
      commandPath.value = null;
      commandError.value = errorMessage(e);
      return false;
    }
  }

  async function restore(): Promise<void> {
    const saved = await loadSetting('chatCommand');
    if (saved) await setCommand(saved);
  }

  // --- tabs -----------------------------------------------------------------

  function openTab(id: string) {
    if (!openIds.value.includes(id)) openIds.value.push(id);
    viewer.active = chatTabId(id);
  }

  function closeTab(id: string) {
    const index = openIds.value.indexOf(id);
    if (index === -1) return;
    openIds.value.splice(index, 1);
    if (viewer.active === chatTabId(id)) {
      const neighbour = openIds.value[index] ?? openIds.value[index - 1];
      viewer.active = neighbour ? chatTabId(neighbour) : BUILD_TAB;
    }
  }

  function create(): Chat {
    const now = Date.now();
    const chat: Chat = {
      id: crypto.randomUUID(),
      title: NEW_CHAT_TITLE,
      sessionId: null,
      access: 'readOnly',
      createdAt: now,
      updatedAt: now,
      items: [],
    };
    chats.value.push(chat);
    openTab(chat.id);
    return chat;
  }

  /** Removes the chat from StudioLite's list. The CLI keeps its own copy of the session. */
  function remove(id: string) {
    if (runtime[id]?.running) void api.chatStop(id).catch(() => undefined);
    closeTab(id);
    chats.value = chats.value.filter((c) => c.id !== id);
    delete runtime[id];
    save();
  }

  function setAccess(id: string, access: ChatAccess) {
    const chat = chats.value.find((c) => c.id === id);
    if (!chat) return;
    chat.access = access;
    save();
  }

  // --- messaging ------------------------------------------------------------

  function addItem(chat: Chat, item: ChatItemData) {
    chat.items.push({ ...item, id: nextItemId++ });
    chat.updatedAt = Date.now();
  }

  async function send(id: string, text: string): Promise<void> {
    const chat = chats.value.find((c) => c.id === id);
    const projectPath = project.path;
    const prompt = text.trim();
    if (!chat || !projectPath || !prompt) return;
    const rt = runtimeOf(id);
    if (rt.running) return;
    if (!isConfigured.value) {
      toasts.warning('Сначала укажите программу чата в панели «Чаты»');
      return;
    }

    if (chat.items.length === 0) {
      const firstLine = prompt.split('\n')[0];
      chat.title =
        firstLine.length > MAX_TITLE_LENGTH
          ? firstLine.slice(0, MAX_TITLE_LENGTH - 1) + '…'
          : firstLine;
    }
    addItem(chat, { kind: 'user', text: prompt });
    rt.running = true;
    rt.stopping = false;
    rt.streaming = '';
    save();

    let finished = false;
    const stderr: string[] = [];

    const apply = (update: ChatUpdate) => {
      switch (update.type) {
        case 'session':
          chat.sessionId = update.id;
          break;
        case 'streamReset':
          rt.streaming = '';
          break;
        case 'streamDelta':
          rt.streaming += update.text;
          break;
        case 'item':
          addItem(chat, update.item);
          break;
        case 'done':
          finished = true;
          break;
      }
    };
    const onEvent = (event: TaskEvent) => {
      if (event.type !== 'lines') return;
      for (const line of event.lines) {
        if (line.stream === 'stdout') interpretChatLine(line.text).forEach(apply);
        else if (line.text.trim()) stderr.push(line.text);
      }
    };

    try {
      const result = await api.chatSend(
        {
          project: projectPath,
          chatId: id,
          command: command.value,
          prompt,
          sessionId: chat.sessionId,
          access: chat.access,
        },
        onEvent,
      );
      if (result.cancelled) {
        // Keep what had already been written when Stop was pressed.
        if (rt.streaming.trim()) addItem(chat, { kind: 'assistant', text: rt.streaming });
        addItem(chat, { kind: 'info', text: 'Ответ остановлен.' });
      } else if (!finished) {
        const details = stderr.slice(-8).join('\n');
        addItem(chat, {
          kind: 'error',
          text: details || `Программа чата завершилась с кодом ${result.exitCode ?? '?'} без ответа.`,
        });
      }
    } catch (e) {
      addItem(chat, { kind: 'error', text: errorMessage(e) });
      toasts.error(e, 'Чат');
    } finally {
      rt.running = false;
      rt.stopping = false;
      rt.streaming = '';
      save();
    }

    // The agent may have changed files in the project.
    if (project.path === projectPath) {
      await Promise.all([
        useGitStore().refreshStatus(),
        useTreeStore().refresh(),
        viewer.reloadActive(),
      ]);
    }
  }

  async function stop(id: string): Promise<void> {
    const rt = runtime[id];
    if (!rt?.running || rt.stopping) return;
    rt.stopping = true;
    try {
      await api.chatStop(id);
    } catch (e) {
      rt.stopping = false;
      toasts.error(e, 'Чат');
    }
  }

  return {
    chats,
    sorted,
    openChats,
    activeChat,
    command,
    commandPath,
    commandError,
    isConfigured,
    runtimeOf,
    loadFor,
    restore,
    setCommand,
    openTab,
    closeTab,
    create,
    remove,
    setAccess,
    send,
    stop,
  };
});
