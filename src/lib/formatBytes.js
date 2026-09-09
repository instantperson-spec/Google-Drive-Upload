/** Human-readable file size (base-1024). */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
