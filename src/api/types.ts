// Mirrors the serde types in src-tauri/src. Change both sides together.

export interface AppError {
  kind: string;
  message: string;
}

export interface ProjectInfo {
  path: string;
  name: string;
  hasGradlew: boolean;
  isGitRepo: boolean;
  gitRoot: string | null;
  gitAvailable: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface FileContent {
  path: string;
  /** Empty for binary files. */
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

export type GitStatusKind = 'modified' | 'added' | 'untracked' | 'deleted' | 'conflict';

export interface GitFileStatus {
  /** Absolute, native separators. */
  path: string;
  status: GitStatusKind;
  isDir: boolean;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  /** Unix seconds. */
  timestamp: number;
  /** Raw %D with full ref names. */
  refs: string;
  subject: string;
  body: string;
}

export interface SdkInfo {
  path: string;
  adb: string;
  emulator: string | null;
  source: string;
}

export type DeviceKind = 'emulator' | 'physical';
export type DeviceState = 'online' | 'offline' | 'unauthorized' | 'stopped';

export interface Device {
  /** Serial for connected devices, `avd:<name>` for AVDs that are not running. */
  id: string;
  kind: DeviceKind;
  name: string;
  serial: string | null;
  avd: string | null;
  state: DeviceState;
}

export interface BootEvent {
  stage: 'launching' | 'waitingForDevice' | 'booting' | 'ready';
  serial: string | null;
  elapsedSecs: number;
}

export type RunTarget = { kind: 'device'; serial: string } | { kind: 'avd'; name: string };

export interface BuildConfig {
  module: string;
  variant: string;
}

export type OutputStream = 'stdout' | 'stderr' | 'info';

export interface OutLine {
  stream: OutputStream;
  text: string;
}

export type TaskEvent = { type: 'lines'; lines: OutLine[] } | { type: 'stage'; label: string };

export interface TaskResult {
  success: boolean;
  cancelled: boolean;
  exitCode: number | null;
  durationMs: number;
  serial: string | null;
  /** Folder with the collected APK/AAB files (packaging only). */
  outputDir: string | null;
}

export type PackageVariant = 'debug' | 'release';
