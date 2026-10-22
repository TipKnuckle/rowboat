// One in-process queue for opportunistic model calls.
//
// The scope is deliberately narrow: this decides WHEN a caller may use the
// model, and nothing else. It owns no persistence, no retries, no dead-letter
// state — services keep their own pending work, checkpoints, and error
// handling exactly as before. A job that never gets a slot is a job that has
// not started, not a job that failed.
//
// Two classes, because only one of them is a scheduling question:
//
//   inline         no scheduling at all. Work that sits inside the user's own
//                  turn and would make the chat slower if delayed (the
//                  auto-permission classifier). Callers simply do not call
//                  into here.
//   opportunistic  idle-gated, serialized, coalesced. Chat titles, event
//                  routing, memory consolidation, knowledge sync, meeting
//                  notes, scheduled tasks.
//
// "Off" (the default) is a genuine pass-through rather than a zero-length
// wait: nothing about this module changes behaviour for someone who has not
// opted in, which is the only way the default is safe for API-backed setups
// where parallel background work is a feature.
//
// Invariants that keep this deadlock-free:
//   - The slot is held across ONE model call, never across a run. A background
//     run mid-tool-call does not sit on the hardware, and a tool that makes
//     its own opportunistic call simply queues behind everyone else.
//   - One dispatcher grants one slot at a time and waits for its release, so
//     concurrency is 1 by construction and the wake storm — every waiter
//     resuming in the same instant — cannot happen.
//   - The queue is strict FIFO. A job waiting on the quiet period holds the
//     line; nothing behind it jumps just because its own threshold would
//     already be satisfied.
//
// There are no timers here on purpose. chatActivity owns the clock and wakes
// its own waiters when a turn ends or the quiet window closes; this module
// just waits on it, so a settings change or a new turn takes effect on the
// event that actually matters rather than on the next poll.

import { AsyncLocalStorage } from "node:async_hooks";
import { PrefixLogger } from "@x/shared";
import { chatActivity } from "./chat-activity.js";

const log = new PrefixLogger("Background");

/**
 * The settings read is a file read and the turns runtime asks before every
 * model step, so cache it briefly. A second is well inside "takes effect
 * immediately" for a settings change and keeps the hot path off the disk.
 */
const SETTING_TTL_MS = 1_000;

export type Release = () => void;

const NOOP_RELEASE: Release = () => { };

interface Ticket {
    readonly reason: string;
    readonly enqueuedAt: number;
    readonly signal?: AbortSignal;
    readonly resolve: (release: Release) => void;
    /** Detach `signal`; set when the ticket is constructed. */
    detach?: () => void;
}

interface CoalescedJob {
    running: boolean;
    /** Requested again while the current pass was in flight. */
    again: boolean;
}

/** Set while a caller holds the slot, so nested calls do not self-deadlock. */
const holdingSlot = new AsyncLocalStorage<boolean>();

class BackgroundScheduler {
    private readonly queue: Ticket[] = [];
    private readonly jobs = new Map<string, CoalescedJob>();
    private dispatcher: Promise<void> | null = null;
    /** Set while the dispatcher has granted its one concurrent slot. */
    private slotRelease: (() => void) | null = null;
    private slotFree: Promise<void> = Promise.resolve();

    private settingValue: number | null | undefined;
    private settingReadAt = 0;
    /** Parked waits that a policy change must release. */
    private readonly wakeListeners = new Set<() => void>();
    /** Bumped on every policy change; waiters compare it to re-decide. */
    private generation = 0;

    /** Quiet threshold in ms, or null when scheduling is off. */
    private async threshold(): Promise<number | null> {
        const now = Date.now();
        const generation = this.generation;
        if (this.settingValue !== undefined && now - this.settingReadAt < SETTING_TTL_MS) {
            return this.settingValue;
        }
        // Lazy on purpose: models/defaults resolves through the DI container,
        // and a static import here would close a cycle back through every
        // module the container wires — including the session layer that waits
        // on this scheduler.
        const { getBackgroundQuietPeriodMs } = await import("../../models/defaults.js");
        const value = await getBackgroundQuietPeriodMs();
        // A read started before invalidation must neither restore the old
        // cache nor return an obsolete policy to an acquiring caller.
        if (this.generation !== generation) return this.threshold();
        this.settingValue = value;
        this.settingReadAt = now;
        return this.settingValue;
    }

    /** Re-read the setting on the next decision (tests, settings writes). */
    invalidateSetting(): void {
        this.generation++;
        this.settingValue = undefined;
        this.settingReadAt = 0;
    }

    /**
     * The setting changed: re-read it and wake anyone parked under the old
     * one.
     *
     * Without this a switch from 15m to immediate — or to off — changes
     * nothing for work already waiting, because the dispatcher waits against
     * the threshold it captured when it started. Waiting work is exactly the
     * work a user is reacting to when they move this control.
     */
    wake(): void {
        this.invalidateSetting();
        for (const listener of [...this.wakeListeners]) {
            listener();
        }
        this.kick();
    }

    /**
     * Take the slot for one model call. Resolves with a release that MUST be
     * called, including on the throw and abort paths — a leaked release wedges
     * the queue for every later caller.
     *
     * When `signal` aborts the wait resolves with a no-op release instead of
     * rejecting: the turns runtime's idiom is to check `signal.aborted` after
     * an await and take its own cancel path, and a gate that throws would
     * surface a cancellation as a model failure.
     */
    async acquire(reason: string, signal?: AbortSignal): Promise<Release> {
        const limit = await this.threshold();
        if (limit === null) return NOOP_RELEASE; // scheduling off: pass through
        if (holdingSlot.getStore()) return NOOP_RELEASE; // already ours
        if (signal?.aborted) return NOOP_RELEASE;

        const release = await new Promise<Release>((resolve) => {
            const onAbort = () => {
                this.remove(entry);
                resolve(NOOP_RELEASE);
                this.kick();
            };
            const entry: Ticket = { reason, enqueuedAt: Date.now(), signal, resolve };
            entry.detach = () => signal?.removeEventListener("abort", onAbort);
            signal?.addEventListener("abort", onAbort, { once: true });
            this.queue.push(entry);
            this.kick();
        });

        // An abort that lands after the grant must still not hand the caller a
        // live slot. The window is two adjacent microtasks — grant, then the
        // caller's own abort check — and a caller that throws on abort would
        // throw past its release, leaving every later caller queued behind a
        // slot nobody holds. Closing it here makes the ordering irrelevant to
        // every caller rather than something each one has to get right.
        if (signal?.aborted) {
            release();
            return NOOP_RELEASE;
        }
        return release;
    }

    /**
     * Run one direct model call as opportunistic work — for the callers that
     * are not agent runs at all: the chat-title and event-routing
     * `generateText` calls that bypass the headless path, and so were invisible
     * to the old gate.
     */
    async runOpportunistic<T>(reason: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const release = await this.acquire(reason, signal);
        try {
            // Inside the try, deliberately: a slot granted moments before an
            // abort still has to be handed back, and a check before the try
            // threw past the finally and stranded every later caller.
            if (signal?.aborted) throw abortError(reason);
            return await holdingSlot.run(true, fn);
        } finally {
            release();
        }
    }

    /**
     * Fire-and-forget maintenance work, deduplicated by key: ten requests
     * while the user chats are one pending job, not ten. A request arriving
     * while the job is already running marks it for one more pass when it
     * finishes, so a late request folds into a follow-up instead of being
     * lost.
     *
     * The task MUST read its inputs when it starts, never before. A job whose
     * input was snapshotted at request time loses whatever arrived during the
     * wait — which is exactly how the agent-notes inbox got cleared without
     * its contents ever being processed.
     */
    enqueue(key: string, task: () => Promise<void>, reason = key): void {
        const existing = this.jobs.get(key);
        if (existing) {
            if (!existing.again) {
                existing.again = true;
                log.log(`${key}: already ${existing.running ? "running" : "queued"} — folded in`);
            }
            return;
        }
        this.jobs.set(key, { running: false, again: false });
        void this.drainJob(key, task, reason);
    }

    private async drainJob(key: string, task: () => Promise<void>, reason: string): Promise<void> {
        const job = this.jobs.get(key);
        if (!job) return;
        for (; ;) {
            job.running = true;
            try {
                await task();
            } catch (err) {
                // The service owns its own error handling and state; a failed
                // pass must not wedge the key or take the queue down with it.
                log.log(`${key}: pass FAILED (${reason}): ${err instanceof Error ? err.message : String(err)}`);
            }
            job.running = false;
            if (!job.again) break;
            job.again = false;
            log.log(`${key}: re-running — requested again while running`);
        }
        this.jobs.delete(key);
    }

    /** How many callers are waiting for a slot. */
    get queuedCount(): number {
        return this.queue.length;
    }

    /** True while a coalesced job for `key` is queued or running. */
    isEnqueued(key: string): boolean {
        return this.jobs.has(key);
    }

    /** Drop pending work (process teardown / tests). */
    clear(): void {
        // Bump first: a dispatcher parked in awaitOrWake must re-decide (and
        // find an empty queue) rather than settle back into the same wait.
        this.generation++;
        this.jobs.clear();
        const pending = this.queue.splice(0);
        for (const ticket of pending) {
            ticket.detach?.();
            ticket.resolve(NOOP_RELEASE);
        }
        for (const listener of [...this.wakeListeners]) {
            listener();
        }
        this.slotRelease?.();
        this.slotRelease = null;
    }

    /**
     * Ensure a dispatcher is draining the queue. Returns immediately; the
     * dispatcher exits on its own once the queue empties.
     */
    private kick(): void {
        if (this.dispatcher) return;
        this.dispatcher = this.dispatch().finally(() => {
            this.dispatcher = null;
            if (this.queue.length > 0) this.kick();
        });
    }

    private async dispatch(): Promise<void> {
        while (this.queue.length > 0) {
            const head = this.queue[0];
            if (head.signal?.aborted) {
                this.remove(head);
                continue;
            }

            const generation = this.generation;
            const limit = await this.threshold();
            // A policy wake may have happened before we registered a waiter.
            if (this.generation !== generation) continue;
            // Off, or flipped off while queued: stop gating the rest.
            if (limit === null) {
                for (const ticket of this.queue.splice(0)) {
                    ticket.detach?.();
                    ticket.resolve(NOOP_RELEASE);
                }
                return;
            }

            // Wait for a genuinely quiet window. Loop, because a turn starting
            // during the wait pushes the deadline out and isQuiet() — not any
            // timer — is what says so.
            let policyChanged = false;
            while (!chatActivity.isQuiet(limit)) {
                if (head.signal?.aborted) break;
                await this.awaitOrWake(chatActivity.waitUntilQuiet(limit), head.signal);
                if (this.generation !== generation) {
                    // Re-decide from the top with the new threshold rather
                    // than finishing this wait under the old one.
                    policyChanged = true;
                    break;
                }
            }
            if (policyChanged) continue;

            if (head.signal?.aborted) {
                this.remove(head);
                continue;
            }
            // Someone ahead of us may have been cancelled while we waited;
            // only the head is ever granted.
            if (this.queue[0] !== head) continue;

            this.remove(head);
            await this.grant(head);
        }
    }

    /**
     * Resolve when the quiet window opens, the caller aborts, or the policy
     * changes. The third is what keeps a settings write from being invisible
     * to work that is already waiting.
     */
    private awaitOrWake(quiet: Promise<void>, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve) => {
            if (signal?.aborted) {
                resolve();
                return;
            }
            const done = () => {
                this.wakeListeners.delete(done);
                signal?.removeEventListener("abort", done);
                resolve();
            };
            if (signal) signal.addEventListener("abort", done, { once: true });
            this.wakeListeners.add(done);
            void quiet.then(done);
        });
    }

    /** Hand over the slot and hold it until released — this is the cap of 1. */
    private grant(ticket: Ticket): Promise<void> {
        let releaseOnce: () => void = () => { };
        const freed = new Promise<void>((resolve) => {
            releaseOnce = () => {
                if (this.slotRelease === null) return;
                this.slotRelease = null;
                resolve();
            };
        });
        this.slotRelease = releaseOnce;

        let called = false;
        ticket.resolve(() => {
            if (called) return;
            called = true;
            releaseOnce();
        });
        return freed;
    }

    /**
     * The only way a ticket leaves the queue: by identity, idempotently.
     *
     * Removal by position is the bug this avoids. An aborting ticket takes
     * itself out, and a moment later the dispatcher wakes from the same
     * abort and reaches the head again — by position that second removal
     * drops the NEXT waiter without ever resolving it, and that job waits
     * forever.
     */
    private remove(ticket: Ticket): void {
        const index = this.queue.indexOf(ticket);
        if (index >= 0) this.queue.splice(index, 1);
        ticket.detach?.();
    }
}

function abortError(reason: string): Error {
    const err = new Error(`Background work cancelled before it reached the model (${reason})`);
    err.name = "AbortError";
    return err;
}

export const backgroundScheduler = new BackgroundScheduler();
