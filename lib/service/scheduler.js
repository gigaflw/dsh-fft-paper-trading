/**
 * Host-side matching loop.
 *
 * The panel polls `tick` only while it is visible, so a closed panel would stop
 * matching and stop settling day boundaries. This scheduler lives on the host
 * fiber instead: `index.ts` starts it in `apply` and disposes it with the fiber.
 * Interval and timer are injected, so tests drive it with a fake clock.
 * @module @dsh-ft/dsh-fft-paper-trading/service/scheduler
 */
/** Node timer that does not keep the process alive on its own. */
export const nodeSchedulerTimer = {
    every(intervalMs, run) {
        const handle = setInterval(run, intervalMs);
        handle.unref?.();
        return () => clearInterval(handle);
    },
};
/** Periodic, non-overlapping `tick` driver. `start`/`stop` are idempotent. */
export class PaperScheduler {
    options;
    timer;
    intervalMs;
    stopTimer;
    running = false;
    constructor(options) {
        this.options = options;
        this.timer = options.timer ?? nodeSchedulerTimer;
        this.intervalMs = options.intervalMs ?? 5_000;
    }
    get started() {
        return this.stopTimer !== undefined;
    }
    start() {
        if (this.stopTimer !== undefined)
            return;
        this.stopTimer = this.timer.every(this.intervalMs, () => { void this.fire(); });
    }
    stop() {
        this.stopTimer?.();
        this.stopTimer = undefined;
    }
    /** One beat. A beat that is still running makes the next one a no-op. */
    async fire() {
        if (this.running)
            return;
        this.running = true;
        try {
            await this.options.tick();
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: scheduled tick failed: ${String(error)}`);
        }
        finally {
            this.running = false;
        }
    }
}
//# sourceMappingURL=scheduler.js.map