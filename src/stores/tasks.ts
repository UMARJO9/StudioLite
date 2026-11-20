import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, type RunTarget, type TaskEvent, type TaskResult } from '../api';
import { errorMessage } from '../utils/errors';
import { loadSetting, saveSetting } from '../utils/persist';
import { formatDuration } from '../utils/time';
import { useConsoleStore } from './console';
import { useDevicesStore } from './devices';
import { useGitStore } from './git';
import { useProjectStore } from './project';
import { useToastsStore } from './toasts';
import { useTreeStore } from './tree';

export type TaskKind =
  | 'build'
  | 'run'
  | 'clean'
  | 'stopDaemon'
  | 'packageDebug'
  | 'packageRelease';
/** The kinds the main split button can be set to. */
export type MainAction = 'build' | 'run';
export type TaskOutcome = 'success' | 'failed' | 'cancelled' | 'error';

export const TASK_TITLE: Record<TaskKind, string> = {
  build: 'Build',
  run: 'Run',
  clean: 'Clean',
  stopDaemon: 'Stop Gradle',
  packageDebug: 'Debug APK',
  packageRelease: 'Release APK + AAB',
};

export interface FinishedTask {
  kind: TaskKind;
  outcome: TaskOutcome;
  durationMs: number;
}

export const useTasksStore = defineStore('tasks', () => {
  const project = useProjectStore();
  const devices = useDevicesStore();
  const output = useConsoleStore();
  const toasts = useToastsStore();

  const running = ref<{ kind: TaskKind; startedAt: number } | null>(null);
  const stage = ref('');
  const stopping = ref(false);
  const elapsedMs = ref(0);
  const last = ref<FinishedTask | null>(null);
  /** What the main button does; remembered between sessions. */
  const lastAction = ref<MainAction>('build');

  const isRunning = computed(() => running.value !== null);

  /** Why a task of this kind cannot start right now, or null if it can. */
  function blockedReason(kind: TaskKind): string | null {
    if (running.value) return 'Дождитесь завершения текущей задачи';
    if (!project.info) return 'Сначала откройте проект';
    if (!project.info.hasGradlew) return 'В проекте нет gradlew';
    if (kind === 'run') {
      const device = devices.selected;
      if (!device) return 'Выберите устройство';
      if (device.state === 'unauthorized') return 'Подтвердите отладку по USB на устройстве';
      if (device.state === 'offline') return 'Устройство не в сети';
    }
    return null;
  }

  function runTarget(): RunTarget | null {
    const device = devices.selected;
    if (!device) return null;
    if (device.state === 'stopped') return device.avd ? { kind: 'avd', name: device.avd } : null;
    return device.serial ? { kind: 'device', serial: device.serial } : null;
  }

  function onEvent(event: TaskEvent) {
    if (event.type === 'lines') output.append(event.lines);
    else stage.value = event.label;
  }

  function setAction(kind: MainAction) {
    lastAction.value = kind;
    saveSetting('lastAction', kind);
  }

  async function restore() {
    const saved = await loadSetting('lastAction');
    if (saved === 'build' || saved === 'run') lastAction.value = saved;
  }

  async function start(kind: TaskKind): Promise<void> {
    const reason = blockedReason(kind);
    if (reason) {
      toasts.warning(reason);
      return;
    }
    const path = project.path;
    const target = kind === 'run' ? runTarget() : null;
    if (!path || (kind === 'run' && !target)) return;

    if (kind === 'build' || kind === 'run') setAction(kind);
    const startedAt = Date.now();
    running.value = { kind, startedAt };
    stage.value = '';
    stopping.value = false;
    elapsedMs.value = 0;
    last.value = null;
    output.clear();

    // Ticks only while a task runs, to show elapsed time.
    const timer = setInterval(() => (elapsedMs.value = Date.now() - startedAt), 1000);
    const title = TASK_TITLE[kind];
    let finished: FinishedTask;
    try {
      let result: TaskResult;
      if (kind === 'run' && target) result = await api.runProject(path, target, onEvent);
      else if (kind === 'packageDebug') result = await api.packageProject(path, 'debug', onEvent);
      else if (kind === 'packageRelease')
        result = await api.packageProject(path, 'release', onEvent);
      else if (kind === 'clean') result = await api.cleanProject(path, onEvent);
      else if (kind === 'stopDaemon') result = await api.stopGradleDaemons(path, onEvent);
      else result = await api.buildProject(path, onEvent);
      const outcome: TaskOutcome = result.cancelled
        ? 'cancelled'
        : result.success
          ? 'success'
          : 'failed';
      finished = { kind, outcome, durationMs: result.durationMs };
      const time = formatDuration(result.durationMs);
      if (outcome === 'success') {
        output.note(`${title}: успешно за ${time}`, 'success');
        if (result.outputDir) {
          toasts.success(`Файлы собраны в ${result.outputDir}`);
          // Show the folder so the files don't have to be hunted down.
          api.revealInFileManager(path, result.outputDir).catch((e) => toasts.error(e));
        }
      } else if (outcome === 'cancelled') {
        output.note(`${title}: остановлено через ${time}`, 'warning');
      } else {
        output.note(`${title}: ошибка (код ${result.exitCode ?? '?'}) за ${time}`, 'error');
        toasts.error(`${title} завершился с ошибкой — подробности в консоли`);
      }
    } catch (e) {
      finished = { kind, outcome: 'error', durationMs: Date.now() - startedAt };
      output.note(`${title}: ${errorMessage(e)}`, 'error');
      toasts.error(e, title);
    } finally {
      clearInterval(timer);
      running.value = null;
      stopping.value = false;
      stage.value = '';
    }
    last.value = finished;

    // The build may have changed generated or tracked files, and Run may have booted a device.
    await Promise.all([useGitStore().refreshStatus(), useTreeStore().refresh(), devices.refresh()]);
  }

  async function stop(): Promise<void> {
    if (!running.value || stopping.value) return;
    stopping.value = true;
    try {
      await api.stopTask();
    } catch (e) {
      stopping.value = false;
      toasts.error(e, 'Stop');
    }
  }

  return {
    running,
    isRunning,
    stage,
    stopping,
    elapsedMs,
    last,
    lastAction,
    blockedReason,
    setAction,
    restore,
    start,
    stop,
  };
});
