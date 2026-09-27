// A simulated clock for tests of timed code: time stands still while the code
// runs and jumps from one scheduled wake-up to the next, so hours of waiting
// take no real time and every instant is exact.

import type { Clock } from "../src/modules/arxiv/arxivFetch";

interface Timer {
  at: number;
  seq: number;
  resolve: () => void;
}

/** Let every pending promise callback run */
export async function flushPromises(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export class VirtualClock implements Clock {
  private time: number;
  private seq = 0;
  private timers: Timer[] = [];

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({
        at: this.time + Math.max(0, ms),
        seq: this.seq++,
        resolve,
      });
    });
  }

  /** Number of wake-ups still scheduled */
  pending(): number {
    return this.timers.length;
  }

  private takeNext(limit = Infinity): Timer | null {
    let best = -1;
    for (let i = 0; i < this.timers.length; i++) {
      const timer = this.timers[i];
      if (timer.at > limit) continue;
      const current = this.timers[best];
      if (
        best < 0 ||
        timer.at < current.at ||
        (timer.at === current.at && timer.seq < current.seq)
      ) {
        best = i;
      }
    }
    return best < 0 ? null : this.timers.splice(best, 1)[0];
  }

  /** Run until `promise` settles, jumping from wake-up to wake-up */
  async run<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let step = 0; step < 1_000_000; step++) {
      await flushPromises();
      if (settled) return promise;
      const next = this.takeNext();
      if (!next) throw new Error("Simulation stalled: nothing scheduled");
      this.time = Math.max(this.time, next.at);
      next.resolve();
    }
    throw new Error("Simulation did not finish");
  }

  /** Run every wake-up due up to `target`, then set the time to `target` */
  async advanceTo(target: number): Promise<void> {
    for (;;) {
      await flushPromises();
      const next = this.takeNext(target);
      if (!next) break;
      this.time = Math.max(this.time, next.at);
      next.resolve();
    }
    this.time = Math.max(this.time, target);
    await flushPromises();
  }

  async advanceBy(ms: number): Promise<void> {
    await this.advanceTo(this.time + ms);
  }
}
