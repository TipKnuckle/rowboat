import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ quietMs: null as number | null }));

vi.mock("../../models/defaults.js", () => ({
    getBackgroundQuietPeriodMs: vi.fn(async () => state.quietMs),
}));

import { backgroundScheduler } from "./background-scheduler.js";
import { ChatActivity, chatActivity } from "./chat-activity.js";
import { getBackgroundQuietPeriodMs } from "../../models/defaults.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A chat turn that runs for `ms`, driving the shared singleton. */
function turn(ms: number): Promise<void> {
    chatActivity.enter();
    return wait(ms).then(() => {
        chatActivity.exit();
    });
}

describe("ChatActivity quiet window", () => {
    it("is never quiet while a turn is running, whatever the threshold", async () => {
        const activity = new ChatActivity();
        activity.enter();
        expect(activity.isQuiet(0)).toBe(false);
        expect(activity.isQuiet(60_000)).toBe(false);
        let resolved = false;
        void activity.waitUntilQuiet(0).then(() => {
            resolved = true;
        });
        await wait(5);
        expect(resolved).toBe(false);
        activity.exit();
        await wait(5);
        expect(resolved).toBe(true);
    });

    it("distinguishes an immediate wait from a quiet period", async () => {
        const activity = new ChatActivity();
        activity.enter();
        activity.exit();

        // Zero threshold: satisfied the moment the turn ends.
        await activity.waitUntilQuiet(0);

        // A fresh turn re-arms the window.
        activity.enter();
        activity.exit();
        expect(activity.isQuiet(50)).toBe(false);
        await wait(60);
        expect(activity.isQuiet(50)).toBe(true);
    });

    it("a turn starting mid-wait pushes the deadline out", async () => {
        const activity = new ChatActivity();
        activity.enter();
        activity.exit();

        let resolved = false;
        const waiting = activity.waitUntilQuiet(60).then(() => {
            resolved = true;
        });

        // Interrupt just before the window would have closed.
        await wait(40);
        activity.enter();
        await wait(40);
        expect(resolved).toBe(false);

        activity.exit();
        await wait(40);
        expect(resolved).toBe(false); // window re-armed from the new turn's end
        await wait(40);
        await waiting;
        expect(resolved).toBe(true);
    });

    it("has never been quiet before anything has run — first job is not stalled", async () => {
        const activity = new ChatActivity();
        expect(activity.isQuiet(600_000)).toBe(true);
    });
});

describe("BackgroundScheduler", () => {
    beforeEach(() => {
        backgroundScheduler.clear();
        backgroundScheduler.invalidateSetting();
        // Reset the shared activity tracker between tests.
        while (chatActivity.activeCount > 0) chatActivity.exit();
        state.quietMs = null;
    });

    it("off: passes straight through, no idle wait, no serialization", async () => {
        state.quietMs = null;
        chatActivity.enter();
        const release = await backgroundScheduler.acquire("test");
        chatActivity.exit();
        expect(backgroundScheduler.queuedCount).toBe(0);
        release();
    });

    it("immediate: never overlaps a turn, but starts the moment it ends", async () => {
        state.quietMs = 0;
        backgroundScheduler.invalidateSetting();

        const busy = turn(60);
        await wait(10);

        let granted = false;
        const acquiring = backgroundScheduler.acquire("test").then((release) => {
            granted = true;
            return release;
        });

        await wait(30);
        // Still inside the turn: a zero threshold must not mean "overlap".
        expect(granted).toBe(false);
        expect(chatActivity.activeCount).toBe(1);

        await busy;
        const release = await acquiring;
        expect(granted).toBe(true);
        expect(chatActivity.activeCount).toBe(0);
        release();
    });

    it("a quiet period holds the slot until the window closes", async () => {
        state.quietMs = 80;
        backgroundScheduler.invalidateSetting();

        const busy = turn(20);
        await wait(5);
        const startedAt = Date.now();
        const acquiring = backgroundScheduler.acquire("test");
        await busy;

        // The turn is over, but the window has not closed.
        await wait(20);
        const release = await acquiring;
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeGreaterThanOrEqual(75);
        release();
    });

    it("serializes: one caller at a time, in arrival order", async () => {
        state.quietMs = 0;
        backgroundScheduler.invalidateSetting();

        const order: string[] = [];
        const first = backgroundScheduler.acquire("a").then((r) => {
            order.push("a:start");
            return { r, name: "a" };
        });
        await wait(5);
        const second = backgroundScheduler.acquire("b").then((r) => {
            order.push("b:start");
            return { r, name: "b" };
        });
        await wait(5);

        expect(order).toEqual(["a:start"]);
        expect(backgroundScheduler.queuedCount).toBe(1);

        const a = await first;
        a.r();
        const b = await second;
        order.push("a:end");
        b.r();

        expect(order).toEqual(["a:start", "b:start", "a:end"]);
    });

    it("releases on a thrown model call so the queue cannot wedge", async () => {
        state.quietMs = 0;
        backgroundScheduler.invalidateSetting();

        await expect(
            backgroundScheduler.runOpportunistic("boom", async () => {
                throw new Error("provider exploded");
            }),
        ).rejects.toThrow("provider exploded");

        const release = await backgroundScheduler.acquire("after");
        release();
        expect(backgroundScheduler.queuedCount).toBe(0);
    });

    it("an aborted wait resolves without granting", async () => {
        state.quietMs = 60_000;
        backgroundScheduler.invalidateSetting();

        const busy = turn(40);
        await wait(5);

        const controller = new AbortController();
        let resolved = false;
        const waiting = backgroundScheduler.acquire("cancellable", controller.signal).then((r) => {
            resolved = true;
            return r;
        });

        await wait(10);
        expect(resolved).toBe(false);
        controller.abort();

        const release = await waiting;
        expect(resolved).toBe(true);
        release();
        await busy;
        expect(backgroundScheduler.queuedCount).toBe(0);
    });

    it("coalesces maintenance requests into one pending job", async () => {
        state.quietMs = 0;
        backgroundScheduler.invalidateSetting();

        let passes = 0;
        let releasePass: () => void = () => { };
        const gate = new Promise<void>((resolve) => {
            releasePass = resolve;
        });

        const job = async () => {
            passes++;
            if (passes === 1) await gate;
        };

        // Ten changes arrive while the first pass is blocked inside the model.
        backgroundScheduler.enqueue("notes", job);
        await wait(5);
        expect(passes).toBe(1);
        expect(backgroundScheduler.isEnqueued("notes")).toBe(true);

        for (let i = 0; i < 10; i++) backgroundScheduler.enqueue("notes", job);
        releasePass();
        await wait(20);

        expect(passes).toBe(2);
        expect(backgroundScheduler.isEnqueued("notes")).toBe(false);
    });

    it("a failed pass neither loses the key nor wedges the queue", async () => {
        state.quietMs = 0;
        backgroundScheduler.invalidateSetting();

        let attempts = 0;
        backgroundScheduler.enqueue("flaky", async () => {
            attempts++;
            throw new Error("model unavailable");
        });
        await wait(20);
        expect(attempts).toBe(1);
        expect(backgroundScheduler.isEnqueued("flaky")).toBe(false);

        const release = await backgroundScheduler.acquire("after-failure");
        release();
    });
});

describe("BackgroundScheduler regressions", () => {
    /** Fail rather than hang: a stranded waiter would otherwise time out dark. */
    const orTimeout = async <T>(label: string, promise: Promise<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout>;
        const loser = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} never resolved`)), 400);
        });
        try {
            return await Promise.race([promise, loser]);
        } finally {
            clearTimeout(timer!);
        }
    };

    beforeEach(() => {
        backgroundScheduler.clear();
        backgroundScheduler.invalidateSetting();
        while (chatActivity.activeCount > 0) chatActivity.exit();
        state.quietMs = null;
    });

    it("rechecks policy when a wake arrives during the dispatcher's read", async () => {
        chatActivity.enter();
        let finishRead!: (value: number) => void;
        let readStarted!: () => void;
        const started = new Promise<void>((resolve) => { readStarted = resolve; });
        const pendingRead = new Promise<number>((resolve) => { finishRead = resolve; });
        const spy = vi.spyOn(backgroundScheduler as unknown as {
            threshold(): Promise<number | null>;
        }, "threshold")
            .mockResolvedValueOnce(900_000)
            .mockImplementationOnce(() => { readStarted(); return pendingRead; })
            .mockResolvedValue(null);
        try {
            const waiting = backgroundScheduler.acquire("policy-read");
            await orTimeout("read start", started);
            backgroundScheduler.wake();
            finishRead(900_000);
            (await orTimeout("policy wake during read", waiting))();
            expect(chatActivity.activeCount).toBe(1);
        } finally {
            backgroundScheduler.clear();
            chatActivity.exit();
            spy.mockRestore();
        }
    });

    it("does not restore an invalidated cache from an older settings read", async () => {
        let finishRead!: (value: number) => void;
        let readStarted!: () => void;
        const started = new Promise<void>((resolve) => { readStarted = resolve; });
        const pendingRead = new Promise<number>((resolve) => { finishRead = resolve; });
        vi.mocked(getBackgroundQuietPeriodMs).mockImplementationOnce(() => {
            readStarted();
            return pendingRead;
        });
        chatActivity.enter();
        try {
            const waiting = backgroundScheduler.acquire("stale-read");
            await orTimeout("settings read start", started);
            state.quietMs = null;
            backgroundScheduler.wake();
            finishRead(900_000);
            (await orTimeout("fresh policy after stale read", waiting))();
            (await orTimeout("subsequent cached policy", backgroundScheduler.acquire("next")))();
            expect(chatActivity.activeCount).toBe(1);
        } finally {
            backgroundScheduler.clear();
            chatActivity.exit();
        }
    });

    it("releases when cancellation lands after acquisition but before the callback", async () => {
        state.quietMs = 0;
        const controller = new AbortController();
        const acquire = backgroundScheduler.acquire.bind(backgroundScheduler);
        const spy = vi.spyOn(backgroundScheduler, "acquire").mockImplementationOnce(async (...args) => {
            const release = await acquire(...args);
            controller.abort();
            return release;
        });
        const callback = vi.fn(async () => "must not run");
        try {
            await expect(backgroundScheduler.runOpportunistic("cancel-after-grant", callback, controller.signal))
                .rejects.toThrow(/cancelled/i);
            expect(callback).not.toHaveBeenCalled();
            (await orTimeout("slot after cancellation", backgroundScheduler.acquire("next")))();
        } finally {
            spy.mockRestore();
            backgroundScheduler.clear();
        }
    });

    it("cancelling the queue head does not strand the job behind it", async () => {
        // The abort handler removes the cancelled ticket, and the dispatcher
        // then reaches the same head again when its wait wakes. Removing by
        // position there dropped the NEXT waiter without resolving it, so it
        // waited forever.
        state.quietMs = 30;
        backgroundScheduler.invalidateSetting();

        const busy = turn(20);
        await wait(5);

        const cancelled = new AbortController();
        const head = backgroundScheduler.acquire("head", cancelled.signal);
        await wait(5);
        const behind = backgroundScheduler.acquire("behind-the-head");
        await wait(5);
        expect(backgroundScheduler.queuedCount).toBe(2);

        cancelled.abort();
        (await orTimeout("cancelled head", head))();

        await busy;
        const release = await orTimeout("job behind the head", behind);
        expect(backgroundScheduler.queuedCount).toBe(0);
        release();
    });

    it("a policy change wakes work that is already parked", async () => {
        // A user moving 15m to immediate is reacting to the work that is
        // waiting. Capturing the threshold and never re-reading it meant the
        // write changed nothing for them.
        state.quietMs = 15 * 60_000;
        backgroundScheduler.invalidateSetting();

        const busy = turn(120);
        await wait(5);
        const waiting = backgroundScheduler.acquire("parked-under-15m");
        await wait(20);
        expect(backgroundScheduler.queuedCount).toBe(1);

        // Switch to immediate mid-wait, the way a settings write does.
        state.quietMs = 0;
        backgroundScheduler.wake();

        // Still must not overlap the turn — immediate is not "overlap".
        await wait(20);
        expect(chatActivity.activeCount).toBe(1);
        expect(backgroundScheduler.queuedCount).toBe(1);

        await busy;
        const release = await orTimeout("work parked under the old policy", waiting);
        expect(backgroundScheduler.queuedCount).toBe(0);
        release();
    });

    it("flipping the setting off while work is queued releases it at once", async () => {
        state.quietMs = 15 * 60_000;
        backgroundScheduler.invalidateSetting();

        const busy = turn(40);
        await wait(5);
        const waiting = backgroundScheduler.acquire("queued-then-turned-off");
        await wait(10);

        state.quietMs = null;
        backgroundScheduler.wake();

        const release = await orTimeout("work after the setting went off", waiting);
        release();
        // Off means overlap is allowed again, so this need not wait for the turn.
        expect(chatActivity.activeCount).toBe(1);
        await busy;
    });

    it("a rejected opportunistic call never leaves the slot held", async () => {
        // Whatever the abort ordering, an aborted caller must not keep a real
        // grant: the next caller would queue behind a slot nobody is using.
        state.quietMs = 0;
        backgroundScheduler.invalidateSetting();

        const busy = turn(20);
        await wait(5);

        const controller = new AbortController();
        const rejected = backgroundScheduler.runOpportunistic(
            "aborted-while-queued",
            async () => "must not run",
            controller.signal,
        );
        await wait(5);
        controller.abort();

        await expect(rejected).rejects.toThrow(/cancelled/i);
        await busy;

        const release = await orTimeout(
            "queue after an abort",
            backgroundScheduler.acquire("after-abort"),
        );
        release();
        expect(backgroundScheduler.queuedCount).toBe(0);
    });
});
