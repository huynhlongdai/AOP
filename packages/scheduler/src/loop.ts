import type { DeterministicScheduler, SchedulerRunResult } from "./scheduler.js";

export interface SchedulerLoopOptions {
  readonly scheduler: DeterministicScheduler;
  readonly signal: AbortSignal;
  readonly idleIntervalMs?: number;
  readonly onResult?: (result: SchedulerRunResult) => void;
  readonly onError?: (error: unknown) => void;
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runSchedulerLoop(options: SchedulerLoopOptions): Promise<void> {
  const idleIntervalMs = options.idleIntervalMs ?? 1_000;
  if (idleIntervalMs < 50 || idleIntervalMs > 60_000) {
    throw new RangeError("idleIntervalMs must be between 50 and 60000");
  }

  while (!options.signal.aborted) {
    try {
      const result = await options.scheduler.runOnce();
      options.onResult?.(result);
      if (result.claimed !== undefined) continue;
    } catch (error) {
      options.onError?.(error);
    }
    await delay(idleIntervalMs, options.signal);
  }
}
