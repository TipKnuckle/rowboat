// Registry of live headless runs, so a background turn can actually be
// stopped.
//
// A deliberate leaf: it imports nothing, because the two sides that need it
// sit at opposite ends of the dependency graph. HeadlessAgentRunner registers
// here and the session layer consults it from stopTurn. Any import in this
// file would risk a cycle back through the DI container.
//
// Why it exists: a headless turn creates no entry in the session layer's live
// advance map, so before this there was no way to interrupt one at all —
// sessions.stopTurn fell through to a durable `cancel` input, which queues
// behind the per-turn lock held by the advance that is already running and so
// only lands once that advance settles. That was tolerable when a background
// run's only long phase was a model call. It stopped being tolerable the
// moment a run could sit in the scheduler's queue waiting for a quiet window:
// a deferred run would then be un-stoppable *before* it had used the hardware.
//
// In-memory only. A restart abandons headless runs anyway — nothing here to
// recover.

interface LiveRun {
    readonly abort: (reason: string) => void;
    /**
     * Settles when the advance does, so a stop can return with the turn
     * actually stopped rather than merely signalled — matching what the
     * session layer already does for live session advances.
     */
    settled: Promise<unknown>;
}

const live = new Map<string, LiveRun>();

export interface HeadlessRunRegistration {
    /** Give the registry the advance's outcome. Call immediately, if at all. */
    readonly track: (settled: Promise<unknown>) => void;
    readonly unregister: () => void;
}

/**
 * Register a live headless turn. Call before starting the advance so there is
 * no window where the turn exists but cannot be stopped.
 */
export function registerHeadlessRun(
    turnId: string,
    abort: (reason: string) => void,
): HeadlessRunRegistration {
    const run: LiveRun = { abort, settled: Promise.resolve() };
    live.set(turnId, run);
    return {
        track: (settled) => {
            run.settled = settled;
        },
        unregister: () => {
            // Only drop our own registration: a re-advance of the same turn id
            // must not be unregistered by the previous advance's cleanup.
            if (live.get(turnId) === run) live.delete(turnId);
        },
    };
}

/**
 * Abort a live background turn. Returns the advance's outcome so the caller
 * can await the stop, or null when no such run is live — in which case the
 * caller falls back to a durable cancel.
 */
export function abortHeadlessRun(turnId: string, reason: string): Promise<unknown> | null {
    const run = live.get(turnId);
    if (!run) return null;
    run.abort(reason);
    return run.settled;
}

export function isHeadlessRunLive(turnId: string): boolean {
    return live.has(turnId);
}
