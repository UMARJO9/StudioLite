import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api, type ProjectInfo } from '../api';
import { loadSetting, saveSetting } from '../utils/persist';
import { separatorOf } from '../utils/paths';
import { useToastsStore } from './toasts';

export const useProjectStore = defineStore('project', () => {
  const info = ref<ProjectInfo | null>(null);
  const opening = ref(false);

  const path = computed(() => info.value?.path ?? null);
  const sep = computed(() => separatorOf(info.value?.path ?? '/'));

  /** What is missing for the project to be fully usable; shown as a banner. */
  const problems = computed<string[]>(() => {
    const p = info.value;
    if (!p) return [];
    const list: string[] = [];
    if (!p.hasGradlew) {
      list.push('В папке нет gradlew — сборка и запуск недоступны.');
    }
    if (!p.gitAvailable) {
      list.push('git не найден в PATH — git-статус и граф недоступны.');
    } else if (!p.isGitRepo) {
      list.push('Папка не является git-репозиторием — git-статус и граф недоступны.');
    }
    return list;
  });

  async function open(projectPath: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const toasts = useToastsStore();
    opening.value = true;
    try {
      const opened = await api.openProject(projectPath);
      info.value = opened;
      saveSetting('lastProject', opened.path);
      return true;
    } catch (e) {
      if (opts.silent) {
        toasts.warning(`Не удалось открыть последний проект: ${projectPath}`);
      } else {
        toasts.error(e, 'Не удалось открыть проект');
      }
      return false;
    } finally {
      opening.value = false;
    }
  }

  async function pickAndOpen(): Promise<void> {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Открыть Android-проект',
        defaultPath: info.value?.path,
      });
      if (typeof selected === 'string') await open(selected);
    } catch (e) {
      useToastsStore().error(e, 'Диалог выбора папки');
    }
  }

  async function restore(): Promise<void> {
    const last = await loadSetting('lastProject');
    if (last) await open(last, { silent: true });
  }

  return { info, path, sep, opening, problems, open, pickAndOpen, restore };
});
