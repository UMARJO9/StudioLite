/** `ts` and `now` in unix seconds. */
export function formatRelative(ts: number, now: number = Date.now() / 1000): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60) return 'только что';
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 14) return `${days} дн назад`;
  if (days < 60) return `${Math.floor(days / 7)} нед назад`;
  if (days < 365) return `${Math.floor(days / 30)} мес назад`;
  const years = Math.floor(days / 365);
  return `${years} г назад`;
}

export function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('ru-RU');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} с`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes} мин ${seconds} с`;
}
