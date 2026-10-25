/**
 * Host-side matching loop.
 *
 * The panel polls `tick` only while it is visible, so a closed panel would stop
 * matching and stop settling day boundaries. This scheduler lives on the host
 * fiber instead: `index.ts` starts it in `apply` and disposes it with the fiber.
 * Interval and timer are injected, so tests drive it with a fake clock.
 * @module @dsh-ft/dsh-fft-paper-trading/service/scheduler
 */

/** Timer abstraction: the only clock dependency of the scheduler. */
export interface SchedulerTimer {
  /** Run `run` every `intervalMs`; return the disposer. */
  every(intervalMs: number, run: () => void): () => void
}

/** Node timer that does not keep the process alive on its own. */
export const nodeSchedulerTimer: SchedulerTimer = {
  every(intervalMs, run) {
    const handle = setInterval(run, intervalMs)
    handle.unref?.()
    return () => clearInterval(handle)
  },
}

export interface PaperSchedulerOptions {
  /** What one beat does; `PaperService.tick` in production. */
  tick: () => Promise<unknown>
  /** Defaults to {@link nodeSchedulerTimer}. */
  timer?: SchedulerTimer
  /** Defaults to 5 s, the same cadence the panel used. */
  intervalMs?: number
  logger?: { warn(message: string): void }
}

/** Periodic, non-overlapping `tick` driver. `start`/`stop` are idempotent. */
export class PaperScheduler {
  private readonly timer: SchedulerTimer
  private readonly intervalMs: number
  private stopTimer: (() => void) | undefined
  private running = false

  constructor(private readonly options: PaperSchedulerOptions) {
    this.timer = options.timer ?? nodeSchedulerTimer
    this.intervalMs = options.intervalMs ?? 5_000
  }

  get started(): boolean {
    return this.stopTimer !== undefined
  }

  start(): void {
    if (this.stopTimer !== undefined) return
    this.stopTimer = this.timer.every(this.intervalMs, () => { void this.fire() })
  }

  stop(): void {
    this.stopTimer?.()
    this.stopTimer = undefined
  }

  /** One beat. A beat that is still running makes the next one a no-op. */
  private async fire(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.options.tick()
    } catch (error) {
      this.options.logger?.warn(`paper-trading: scheduled tick failed: ${String(error)}`)
    } finally {
      this.running = false
    }
  }
}
