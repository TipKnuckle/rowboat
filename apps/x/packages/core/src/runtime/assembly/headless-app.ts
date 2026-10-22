import container from "../../di/container.js";
import {
    type HeadlessAgentHandle,
    type HeadlessAgentOptions,
    type HeadlessAgentResult,
    type IHeadlessAgentRunner,
} from "./headless.js";

function runner(): IHeadlessAgentRunner {
    return container.resolve<IHeadlessAgentRunner>("headlessAgentRunner");
}

export function startHeadlessAgent(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentHandle> {
    return runner().start(options);
}

export function runHeadlessAgent(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentResult & { turnId: string }> {
    return runner().run(options);
}

// Background work: the run is marked opportunistic, so the scheduler gates
// every model call it makes — at the start AND between steps — rather than
// checking once before launch, which is all the old boolean did.
//
// Nothing is awaited here. Waiting belongs inside the run's model calls, so
// the durable log never records a step that was not issued and a run releases
// the slot while it waits on tools.
//
// One consequence worth stating: a run parked in the gate is parked *inside*
// the advance, which holds the turn's per-turn lock. A durable `cancel` input
// would queue behind that lock, so stopping a deferred run relies on the
// headless run registry aborting it instead — see headless-run-registry.ts.
const BACKGROUND = { background: true } as const;

/** startHeadlessAgent for background work: honors the background scheduling setting. */
export function startWhenPossible(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentHandle> {
    return startHeadlessAgent({ ...options, ...BACKGROUND });
}

/** runHeadlessAgent for background work: honors the background scheduling setting. */
export function runWhenPossible(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentResult & { turnId: string }> {
    return runHeadlessAgent({ ...options, ...BACKGROUND });
}

export { toolInputPaths } from "./headless.js";
