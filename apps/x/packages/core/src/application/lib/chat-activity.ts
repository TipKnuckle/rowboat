// Tracks when a user-facing chat turn is running, and when the chat has been
// genuinely quiet.
//
// Both chat runtimes mark their turns here (sessions/sessions.ts for the
// turns runtime, runtime/legacy/engine.ts trigger() for legacy runs). The
// background scheduler consults it before letting opportunistic model calls
// reach the hardware — on a local model they share one GPU with the chat.
//
// Two questions, because the user setting distinguishes them — and both are
// one call, differing only by a number. Collapsing them into "idle" versus
// "idle plus a wait" is exactly how "never overlap the chat" and "zero wait"
// got confused in the first place:
//
//   waitUntilQuiet(0) — no turn is running: "run as soon as the chat ends".
//   waitUntilQuiet(n) — no turn is running *and* none has run for n ms: the
//                       hysteresis that keeps maintenance work off the
//                       hardware while the human is still reading and typing.
//
// The old boolean had only the first, and that is the whole contention
// complaint: it released every waiter at zero idle, which is precisely the
// moment the user reads the answer and starts the next message.
//
// Both require `active === 0`. That invariant is what makes enqueue order
// irrelevant — a job enqueued before chatActivity.enter() still cannot start
// beside the turn it belongs to.

interface Waiter {
    /** Zero for a bare idle wait, otherwise the quiet threshold in ms. */
    readonly thresholdMs: number;
    readonly resolve: () => void;
}

export class ChatActivity {
    private active = 0;
    /**
     * Start of the current busy interval, or the end of the last one once
     * idle. The quiet window is measured from here in both directions, so a
     * turn that has not finished yet can never look "quiet" by going stale.
     */
    private lastActivityAt = 0;
    private readonly waiters = new Set<Waiter>();
    private timer: ReturnType<typeof setTimeout> | null = null;

    enter(): void {
        this.active++;
        // A starting turn resets the quiet clock. Without this, a user typing
        // a stream of short messages leaves a gap after every turn wide
        // enough for maintenance work to slip into.
        this.lastActivityAt = Date.now();
        this.notify();
    }

    exit(): void {
        const wasActive = this.active;
        this.active = Math.max(0, this.active - 1);
        if (this.active === 0 && wasActive > 0) {
            this.lastActivityAt = Date.now();
        }
        // Notified even when still busy: a waiters' threshold may already be
        // satisfied by a wait that predates this turn.
        this.notify();
    }

    get activeCount(): number {
        return this.active;
    }

    /** Timestamp the current busy interval started, or the last one ended. */
    get lastActivity(): number {
        return this.lastActivityAt;
    }

    /** True when no turn runs and none has run within the threshold. */
    isQuiet(thresholdMs: number): boolean {
        if (this.active !== 0) return false;
        if (thresholdMs <= 0) return true;
        if (this.lastActivityAt === 0) return true; // nothing has ever run
        return Date.now() - this.lastActivityAt >= thresholdMs;
    }

    /**
     * Resolves once no turn is running and the last one ended at least
     * `thresholdMs` ago. A turn starting while we wait pushes the deadline
     * out, because enter() restamps `lastActivityAt` and we re-check rather
     * than trust the original timer.
     *
     * `0` is the bare "no turn is running" wait.
     */
    waitUntilQuiet(thresholdMs: number): Promise<void> {
        return this.waitFor(Math.max(0, thresholdMs));
    }

    private waitFor(thresholdMs: number): Promise<void> {
        if (this.isQuiet(thresholdMs)) return Promise.resolve();
        return new Promise((resolve) => {
            this.waiters.add({ thresholdMs, resolve });
            this.armTimer();
        });
    }

    private notify(): void {
        for (const waiter of [...this.waiters]) {
            if (this.isQuiet(waiter.thresholdMs)) {
                this.waiters.delete(waiter);
                waiter.resolve();
            }
        }
        this.armTimer();
    }

    /**
     * Re-arm for the earliest remaining deadline. Cheap and idempotent: the
     * timer is only ever a "come back and look again" nudge, never the source
     * of truth — `isQuiet` is.
     */
    private armTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.waiters.size === 0 || this.active !== 0) return;

        let soonest = Infinity;
        for (const waiter of this.waiters) {
            const due = this.lastActivityAt + waiter.thresholdMs;
            if (due < soonest) soonest = due;
        }
        if (!Number.isFinite(soonest)) return;

        const delay = Math.max(0, soonest - Date.now());
        this.timer = setTimeout(() => {
            this.timer = null;
            this.notify();
        }, delay);
        // Never hold the process open for a scheduling nudge.
        this.timer.unref?.();
    }
}

export const chatActivity = new ChatActivity();
