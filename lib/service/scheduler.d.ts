/**
 * Host-side matching loop.
 *
 * The panel polls `tick` only while it is visible, so a closed panel would stop
 * matching and stop settling day boundaries. This scheduler lives on the host
 * fiber instead: `index.ts` starts it in `apply` and disposes it with the fiber.
 * Interval and timer are injected, so tests drive it with a fake clock.
 * @module @ft/dsh-fft-paper-trading/service/scheduler
 */
/** Timer abstraction: the only clock dependency of the scheduler. */
export interface SchedulerTimer {
    /** Run `run` every `intervalMs`; return the disposer. */
    every(intervalMs: number, run: () => void): () => void;
}
/** Node timer that does not keep the process alive on its own. */
export declare const nodeSchedulerTimer: SchedulerTimer;
export interface PaperSchedulerOptions {
    /** What one beat does; `PaperService.tick` in production. */
    tick: () => Promise<unknown>;
    /** Defaults to {@link nodeSchedulerTimer}. */
    timer?: SchedulerTimer;
    /** Defaults to 5 s, the same cadence the panel used. */
    intervalMs?: number;
    logger?: {
        warn(message: string): void;
    };
}
/** Periodic, non-overlapping `tick` driver. `start`/`stop` are idempotent. */
export declare class PaperScheduler {
    private readonly options;
    private readonly timer;
    private readonly intervalMs;
    private stopTimer;
    private running;
    constructor(options: PaperSchedulerOptions);
    get started(): boolean;
    start(): void;
    stop(): void;
    /** One beat. A beat that is still running makes the next one a no-op. */
    private fire;
}
//# sourceMappingURL=scheduler.d.ts.map