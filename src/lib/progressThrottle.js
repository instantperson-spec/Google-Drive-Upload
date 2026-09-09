/**
 * Limit React state updates during high-frequency upload progress events.
 * @param {(value: number) => void} callback
 * @param {number} [intervalMs=800]
 */
export function createProgressThrottle(callback, intervalMs = 800) {
  let lastEmit = 0;
  let pending = null;
  let timer = null;

  const flush = () => {
    timer = null;
    if (pending === null) return;
    lastEmit = Date.now();
    callback(pending);
    pending = null;
  };

  return (value) => {
    pending = value;
    const now = Date.now();
    if (now - lastEmit >= intervalMs) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
      return;
    }
    if (!timer) {
      timer = setTimeout(flush, intervalMs - (now - lastEmit));
    }
  };
}
