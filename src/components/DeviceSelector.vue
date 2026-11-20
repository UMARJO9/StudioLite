<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  Check,
  ChevronDown,
  LoaderCircle,
  MonitorSmartphone,
  Play,
  RefreshCw,
  Smartphone,
} from 'lucide-vue-next';
import type { Device, DeviceState } from '../api';
import { bootStageText, useDevicesStore } from '../stores/devices';

const store = useDevicesStore();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const STATE_TEXT: Record<DeviceState, string> = {
  online: 'подключено',
  offline: 'не в сети',
  unauthorized: 'нет авторизации — подтвердите отладку на устройстве',
  stopped: 'выключен',
};

function stateText(device: Device): string {
  if (store.booting?.avd && store.booting.avd === device.avd) {
    return store.booting.event ? bootStageText(store.booting.event) : 'запуск';
  }
  return STATE_TEXT[device.state];
}

const isBooting = (device: Device) => !!device.avd && store.booting?.avd === device.avd;

const buttonLabel = computed(() => {
  if (store.selected) return store.selected.name;
  if (store.loading && !store.devices.length) return 'Поиск устройств…';
  if (store.error) return 'Устройства недоступны';
  return 'Нет устройств';
});

const groups = computed(() => [
  { title: 'Запущенные', devices: store.running },
  { title: 'Эмуляторы (выключены)', devices: store.stopped },
]);

function choose(device: Device) {
  store.select(device);
  open.value = false;
}

function onPointerDown(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
function closeOnBlur() {
  open.value = false;
}

watch(open, (isOpen) => {
  const method = isOpen ? 'addEventListener' : 'removeEventListener';
  window[method]('pointerdown', onPointerDown as EventListener, true);
  window[method]('keydown', onKey as EventListener);
  window[method]('blur', closeOnBlur);
});
onBeforeUnmount(() => {
  open.value = false;
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('blur', closeOnBlur);
});
</script>

<template>
  <div ref="root" class="device-selector">
    <button
      class="btn outlined trigger"
      :title="store.error ?? 'Устройство для запуска'"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
    >
      <LoaderCircle v-if="store.selected && isBooting(store.selected)" :size="15" class="spin" />
      <Smartphone v-else-if="store.selected?.kind === 'physical'" :size="15" />
      <MonitorSmartphone v-else :size="15" />
      <span class="ellipsis label">{{ buttonLabel }}</span>
      <span v-if="store.selected" class="dot" :class="store.selected.state" />
      <ChevronDown :size="14" class="chevron" />
    </button>

    <div v-if="open" class="dropdown" role="listbox">
      <div class="dropdown-header">
        <span>Устройства</span>
        <button
          class="btn small icon"
          title="Обновить список"
          :disabled="store.loading"
          @click="store.refresh({ notify: true })"
        >
          <RefreshCw :size="13" :class="{ spin: store.loading }" />
        </button>
      </div>

      <div v-if="store.error" class="message error">{{ store.error }}</div>
      <div v-else-if="!store.devices.length" class="message">
        {{ store.loading ? 'Поиск устройств…' : 'Нет ни устройств, ни эмуляторов' }}
      </div>

      <template v-for="group in groups" :key="group.title">
        <template v-if="group.devices.length">
          <div class="group-title">{{ group.title }}</div>
          <div
            v-for="device in group.devices"
            :key="device.id"
            class="item"
            :class="{ selected: device.id === store.selectedId }"
            role="option"
            :aria-selected="device.id === store.selectedId"
            @click="choose(device)"
          >
            <Smartphone v-if="device.kind === 'physical'" :size="15" class="item-icon" />
            <MonitorSmartphone v-else :size="15" class="item-icon" />
            <div class="item-text">
              <div class="ellipsis item-name">{{ device.name }}</div>
              <div class="ellipsis item-state">
                <span class="dot" :class="device.state" />
                {{ stateText(device) }}
                <template v-if="device.serial"> · {{ device.serial }}</template>
              </div>
            </div>
            <LoaderCircle v-if="isBooting(device)" :size="14" class="spin" />
            <button
              v-else-if="device.state === 'stopped'"
              class="btn small icon"
              title="Запустить эмулятор"
              :disabled="!!store.booting"
              @click.stop="store.startAvd(device)"
            >
              <Play :size="13" />
            </button>
            <Check v-else-if="device.id === store.selectedId" :size="14" class="check" />
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.device-selector {
  position: relative;
}
.trigger {
  width: 220px;
  background: var(--bg-input);
}
.label {
  flex: 1;
  text-align: left;
}
.chevron {
  flex: none;
  color: var(--text-dim);
}
.dot {
  display: inline-block;
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-dim);
}
.dot.online {
  background: var(--green);
}
.dot.unauthorized {
  background: var(--orange);
}
.dot.offline {
  background: var(--red);
}
.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 800;
  width: 320px;
  max-height: min(480px, calc(100vh - 80px));
  padding: 4px;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
}
.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 2px 8px;
  color: var(--text-bright);
  font-weight: 600;
}
.group-title {
  padding: 8px 8px 3px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.message {
  padding: 10px 8px;
  color: var(--text-dim);
}
.message.error {
  color: var(--orange);
  user-select: text;
  -webkit-user-select: text;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 3px 6px 3px 8px;
  border-radius: 4px;
}
.item:hover {
  background: var(--bg-hover);
}
.item.selected {
  background: var(--bg-active);
}
.item-icon {
  flex: none;
  color: var(--text-dim);
}
.item-text {
  flex: 1;
  min-width: 0;
}
.item-name {
  color: var(--text-bright);
}
.item-state {
  color: var(--text-dim);
  font-size: 11px;
}
.check {
  flex: none;
  margin-right: 4px;
  color: var(--accent);
}
</style>
