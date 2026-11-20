import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, type BootEvent, type Device } from '../api';
import { toAppError } from '../utils/errors';
import { loadSetting, saveSetting } from '../utils/persist';
import { useProjectStore } from './project';
import { useToastsStore } from './toasts';

const BOOT_STAGE_TEXT: Record<BootEvent['stage'], string> = {
  launching: 'запуск',
  waitingForDevice: 'ожидание устройства',
  booting: 'загрузка Android',
  ready: 'готов',
};

export function bootStageText(event: BootEvent): string {
  return `${BOOT_STAGE_TEXT[event.stage]}, ${event.elapsedSecs} с`;
}

export const useDevicesStore = defineStore('devices', () => {
  const project = useProjectStore();
  const toasts = useToastsStore();

  const devices = ref<Device[]>([]);
  const loading = ref(false);
  /** Why the list is empty (e.g. SDK not found). Shown inside the selector. */
  const error = ref<string | null>(null);

  const selectedId = ref<string | null>(null);
  /** AVD name of the selection, so it survives the emulator starting or stopping. */
  const selectedAvd = ref<string | null>(null);

  /** AVD being started from the selector, with its latest progress. */
  const booting = ref<{ avd: string; event: BootEvent | null } | null>(null);

  const running = computed(() => devices.value.filter((d) => d.state !== 'stopped'));
  const stopped = computed(() => devices.value.filter((d) => d.state === 'stopped'));
  const selected = computed(() => devices.value.find((d) => d.id === selectedId.value) ?? null);

  function select(device: Device) {
    if (selectedId.value === device.id && selectedAvd.value === device.avd) return;
    selectedId.value = device.id;
    selectedAvd.value = device.avd;
    saveSetting('selectedDevice', { id: device.id, avd: device.avd });
  }

  /** Keeps the selection pointing at the same device after the list changes. */
  function reconcile() {
    const list = devices.value;
    const match =
      list.find((d) => d.id === selectedId.value) ??
      // Same AVD, different state: `avd:Pixel_7` became `emulator-5554` or vice versa.
      (selectedAvd.value ? list.find((d) => d.avd === selectedAvd.value) : undefined) ??
      list.find((d) => d.state === 'online') ??
      list[0];
    if (match) select(match);
  }

  async function restore(): Promise<void> {
    const saved = await loadSetting('selectedDevice');
    if (saved && selectedId.value === null) {
      selectedId.value = saved.id;
      selectedAvd.value = saved.avd;
    }
  }

  async function refresh(opts: { notify?: boolean } = {}): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      devices.value = await api.listDevices(project.path);
      error.value = null;
      reconcile();
    } catch (e) {
      devices.value = [];
      error.value = toAppError(e).message;
      // On background refreshes the message stays in the selector; no toast on every focus.
      if (opts.notify) toasts.error(e, 'Устройства');
    } finally {
      loading.value = false;
    }
  }

  /** Starts a stopped AVD and resolves when Android has booted. */
  async function startAvd(device: Device): Promise<void> {
    const avd = device.avd;
    if (!avd || booting.value) return;
    select(device);
    booting.value = { avd, event: null };
    try {
      await api.startAvd(project.path, avd, (event) => {
        if (booting.value?.avd === avd) booting.value = { avd, event };
      });
      toasts.success(`Эмулятор «${device.name}» запущен`);
    } catch (e) {
      toasts.error(e, `Эмулятор «${device.name}»`);
    } finally {
      booting.value = null;
      await refresh();
    }
  }

  return {
    devices,
    running,
    stopped,
    selected,
    selectedId,
    loading,
    error,
    booting,
    select,
    restore,
    refresh,
    startAvd,
  };
});
