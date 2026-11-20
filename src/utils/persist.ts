import { LazyStore } from '@tauri-apps/plugin-store';

const store = new LazyStore('settings.json');

export interface ChatModel {
  /** What is passed to the chat program. */
  id: string;
  label: string;
  hint: string;
}

export interface Settings {
  lastProject: string | null;
  selectedDevice: { id: string; avd: string | null } | null;
  lastAction: 'build' | 'run';
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  treeCollapsed: boolean;
  graphCollapsed: boolean;
  /** Name or full path of the command-line program behind the chat. */
  chatCommand: string;
  /** Models offered in the chat's model picker; the list lives only in local settings. */
  chatModels: ChatModel[];
  chatsHeight: number;
  chatsCollapsed: boolean;
  graphHeight: number;
}

export async function loadSetting<K extends keyof Settings>(key: K): Promise<Settings[K] | undefined> {
  try {
    return (await store.get<Settings[K]>(key)) ?? undefined;
  } catch (e) {
    console.warn('settings: load failed', key, e);
    return undefined;
  }
}

/** Fire-and-forget: a failed save must never break the UI. The plugin debounces disk writes. */
export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  store.set(key, value).catch((e) => console.warn('settings: save failed', key, e));
}
