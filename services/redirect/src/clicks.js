import { clicksBuffered, clicksFlushedTotal, clicksDroppedTotal } from './metrics.js';

// Click events are buffered in memory and flushed in batches. The redirect
// response is never delayed by this. Delivery is at-most-once: a crash loses
// the buffer, and a sustained api outage drops the oldest events once the
// buffer is full (counted in clicks_dropped_total). Swapping this for a
// durable queue is a documented exercise.
export function createClickBuffer({ apiClient, flushIntervalMs, batchSize, maxBuffer, logger }) {
  const buffer = [];
  let timer = null;
  let inFlight = null;   // promise of the flush currently running, if any

  function push(event) {
    if (buffer.length >= maxBuffer) {
      buffer.shift();
      clicksDroppedTotal.inc({ reason: 'buffer_full' });
    }
    buffer.push(event);
    clicksBuffered.set(buffer.length);
    if (buffer.length >= batchSize) void flush();
  }

  // Returns the in-progress flush when one is running, so stop() can await it
  // instead of racing it.
  function flush() {
    if (inFlight) return inFlight;
    if (buffer.length === 0) return Promise.resolve();
    inFlight = drain().finally(() => {
      clicksBuffered.set(buffer.length);
      inFlight = null;
    });
    return inFlight;
  }

  async function drain() {
    while (buffer.length > 0) {
      const batch = buffer.slice(0, batchSize);
      let result;
      try {
        result = await apiClient.sendClicks(batch);
      } catch (err) {
        logger.warn({ err: err.message, size: batch.length }, 'click flush threw, will retry');
        result = { ok: false, retryable: true };
      }
      if (result.ok) {
        buffer.splice(0, batch.length);
        clicksFlushedTotal.inc(batch.length);
        continue;
      }
      if (result.retryable) break;    // leave the batch in place, retry on next tick
      buffer.splice(0, batch.length); // permanently rejected: drop it, count it, move on
      clicksDroppedTotal.inc({ reason: 'rejected' }, batch.length);
    }
  }

  function start() {
    if (!timer) {
      timer = setInterval(() => void flush(), flushIntervalMs);
      timer.unref();
    }
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    await flush();
    if (buffer.length > 0) {
      clicksDroppedTotal.inc({ reason: 'shutdown' }, buffer.length);
      logger.warn({ dropped: buffer.length }, 'click events dropped at shutdown');
      buffer.length = 0;
    }
  }

  return { push, flush, start, stop, get size() { return buffer.length; } };
}
