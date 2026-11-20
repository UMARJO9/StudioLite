// The only place that talks to the Rust backend.
import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  BootEvent,
  BuildConfig,
  Commit,
  Device,
  FileEntry,
  GitFileStatus,
  ProjectInfo,
  RunTarget,
  SdkInfo,
  TaskEvent,
  TaskResult,
} from './types';

export * from './types';

function channel<T>(onMessage: (event: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = onMessage;
  return ch;
}

export const api = {
  openProject: (path: string) => invoke<ProjectInfo>('open_project', { path }),
  readDir: (project: string, path: string) => invoke<FileEntry[]>('read_dir', { project, path }),
  openInSystem: (project: string, path: string) =>
    invoke<void>('open_in_system', { project, path }),
  revealInFileManager: (project: string, path: string) =>
    invoke<void>('reveal_in_file_manager', { project, path }),

  gitBranch: (project: string) => invoke<string | null>('git_branch', { project }),
  gitStatus: (project: string) => invoke<GitFileStatus[]>('git_status', { project }),
  gitLog: (project: string, skip: number, limit: number) =>
    invoke<Commit[]>('git_log', { project, skip, limit }),

  findSdk: (project: string | null) => invoke<SdkInfo>('find_sdk', { project }),
  listDevices: (project: string | null) => invoke<Device[]>('list_devices', { project }),
  /** Resolves with the serial once the emulator has finished booting. */
  startAvd: (project: string | null, avd: string, onEvent: (e: BootEvent) => void) =>
    invoke<string>('start_avd', { project, avd, onEvent: channel(onEvent) }),

  buildProject: (project: string, onEvent: (e: TaskEvent) => void, config?: BuildConfig) =>
    invoke<TaskResult>('build_project', { project, config, onEvent: channel(onEvent) }),
  runProject: (
    project: string,
    target: RunTarget,
    onEvent: (e: TaskEvent) => void,
    config?: BuildConfig,
  ) => invoke<TaskResult>('run_project', { project, target, config, onEvent: channel(onEvent) }),
  cleanProject: (project: string, onEvent: (e: TaskEvent) => void) =>
    invoke<TaskResult>('clean_project', { project, onEvent: channel(onEvent) }),
  stopGradleDaemons: (project: string, onEvent: (e: TaskEvent) => void) =>
    invoke<TaskResult>('stop_gradle_daemons', { project, onEvent: channel(onEvent) }),
  stopTask: () => invoke<boolean>('stop_task'),
};
