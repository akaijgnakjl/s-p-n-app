/** Yield a browser task without repeatedly depending on background-tab timers. */
export function createTaskYield({
  browser = typeof globalThis.process?.versions?.node !== 'string',
  scheduler = globalThis.scheduler,
  MessageChannel: Channel = globalThis.MessageChannel,
  timer = globalThis.setTimeout,
} = {}) {
  if (browser && typeof scheduler?.yield === 'function') {
    // Keep the receiver: native Scheduler methods require their owning object.
    return () => { try { return Promise.resolve(scheduler.yield()); } catch (error) { return Promise.reject(error); } };
  }
  if (browser && typeof Channel === 'function') {
    return () => new Promise((resolve, reject) => {
      let channel, settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        for (const port of [channel?.port1, channel?.port2]) {
          if (!port) continue;
          port.onmessage = null; port.onmessageerror = null;
          try { port.close(); } catch { /* Cleanup the other port even if this one is already closed. */ }
        }
        if (error) reject(error); else resolve();
      };
      try {
        channel = new Channel();
        channel.port1.onmessage = () => finish();
        channel.port1.onmessageerror = () => finish(new Error('タスクの再開に失敗しました。'));
        channel.port2.postMessage(null);
      } catch (error) { finish(error); }
    });
  }
  // Node unit tests/fixture generation keep their existing event-loop behavior.
  // Modern browsers have MessageChannel; never silently use a throttled timer there.
  if (!browser && typeof timer === 'function') return () => new Promise(resolve => timer(resolve, 0));
  return () => Promise.reject(new Error('この環境ではtask yieldを利用できません。'));
}

/** Callers retain their operation-specific AbortSignal checks immediately after await. */
export const yieldTask = createTaskYield();
