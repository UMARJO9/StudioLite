import { LazyStore } from '@tauri-apps/plugin-store';

const store = new LazyStore('settings.json');

export interface Settings {
  lastProject: string | null;
  selectedDevice: { id: string; avd: string | null } | null;
  lastAction: 'build' | 'run';
  sidebarWidth: number;
  sidebarCollapsed: boolean;
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
