import type { z } from "zod";
import type { TurnAnalytics } from "@x/shared/dist/analytics.js";
import type { AssistantMessage, UserMessage } from "@x/shared/dist/message.js";
import type { InputOrigin } from "@x/shared/dist/origins.js";
import type {
    JsonValue,
    RequestedAgent,
    ToolResultData,
    TurnContext,
    TurnEvent,
    TurnStreamEvent,
    TurnSuspended,
    TurnUsage,
} from "@x/shared/dist/turns.js";

export interface CreateTurnInput {
    agent: z.infer<typeof RequestedAgent>;
    sessionId?: string | null;
    context: z.infer<typeof TurnContext>;
    input: z.infer<typeof UserMessage>;
    analytics?: TurnAnalytics;
    // Persisted verbatim as turn_created.origin (see @x/shared origins).
    origin?: InputOrigin;
    config: {
        autoPermission?: boolean;
        humanAvailable: boolean;
        maxModelCalls?: number;
        // Canonical per-turn reasoning effort; omitted = auto (provider
        // default, byte-identical requests to today).
        reasoningEffort?: "low" | "medium" | "high";
    };
}

// Steering: a caller-supplied drain the advance polls at each model-call
// boundary (after the tool batch settles and completion is ruled out,
// immediately before the next model call is requested). Returned messages
// are treated as consumed and appended durably as input_added events, so
// they ride the very next request. The dual of the abort signal: both are
// ephemeral per-invocation channels into a live advance that become durable
// only when acted on. The turn layer never learns which SOURCE drains
// (session queue, test fixture); each message may carry an origin label
// (what outside the runtime caused it — see @x/shared origins) that is
// written onto its input_added verbatim and never acted on. An accepted
// input resets the model-call budget.
export interface AddedInput {
    message: z.infer<typeof UserMessage>;
    origin?: InputOrigin;
}
export type TakeAddedInputs = () => AddedInput[] | Promise<AddedInput[]>;

// Background scheduling: a caller-supplied gate the advance awaits at each
// model-call boundary, immediately before the next step is requested. Same
// plumbing and same lifetime as takeInputs — ephemeral, per-invocation, never
// durable — and the same role as the dual of the abort signal: both are
// channels into a live advance that leave no trace unless acted on.
//
// Contract: resolve when it is safe to issue a model call, OR when the
// advance's signal aborts. It must not reject on abort — the loop checks
// signal.aborted right after and takes its own durable cancel path, and a
// rejection here would surface a cancellation as a model failure.
//
// It resolves with a release invoked when that step settles, on every path
// including throw and abort. The gate HOLDS the slot across the model call
// rather than merely preceding it: that is what makes "one background model
// call at a time" true, and it is why the gate wraps `runModelStep` instead of
// the whole run. A background run waiting on a tool therefore does not sit on
// the hardware.
//
// Omitting the gate means "never wait", which is what every interactive turn,
// every manual run, and every subagent does. Deferral is declared by the
// ENTRY POINT that schedules background work, not inferred from the turn:
// sessionId === null is not a safe proxy, because a subagent spawned from a
// live chat is also session-less and must never be deferred.
export type ModelGate = (
    info: { modelCallIndex: number },
) => Promise<() => void>;

export interface AdvanceOptions {
    signal?: AbortSignal;
    takeInputs?: TakeAddedInputs;
    modelGate?: ModelGate;
}

// Exactly one external input per advanceTurn invocation.
export type TurnExternalInput =
    | {
          type: "permission_decision";
          toolCallId: string;
          decision: "allow" | "deny";
          metadata?: JsonValue;
      }
    | {
          type: "async_tool_progress";
          toolCallId: string;
          progress: JsonValue;
      }
    | {
          type: "async_tool_result";
          toolCallId: string;
          result: z.infer<typeof ToolResultData>;
      }
    | {
          type: "cancel";
          reason?: string;
      };

export type TurnOutcome =
    | {
          status: "completed";
          output: z.infer<typeof AssistantMessage>;
          finishReason: string;
          usage: z.infer<typeof TurnUsage>;
      }
    | {
          status: "suspended";
          pendingPermissions: z.infer<typeof TurnSuspended>["pendingPermissions"];
          pendingAsyncTools: z.infer<typeof TurnSuspended>["pendingAsyncTools"];
          usage: z.infer<typeof TurnUsage>;
      }
    | {
          status: "failed";
          error: string;
          // Mirrors turn_failed.code (e.g. MODEL_CALL_LIMIT_ERROR_CODE).
          code?: string;
          usage: z.infer<typeof TurnUsage>;
      }
    | {
          status: "cancelled";
          reason?: string;
          usage: z.infer<typeof TurnUsage>;
      };

export interface TurnExecution {
    events: AsyncIterable<TurnStreamEvent>;
    outcome: Promise<TurnOutcome>;
}

export interface Turn {
    turnId: string;
    events: Array<z.infer<typeof TurnEvent>>;
}

export interface ITurnRuntime {
    createTurn(input: CreateTurnInput): Promise<string>;
    advanceTurn(
        turnId: string,
        input?: TurnExternalInput,
        options?: AdvanceOptions,
    ): TurnExecution;
    getTurn(turnId: string): Promise<Turn>;
    // Removes the turn's file. Idempotent — a missing turn is not an error.
    // Callers own lifecycle safety: never delete a turn that may still be
    // advancing (session deletion stops live advances first).
    deleteTurn(turnId: string): Promise<void>;
}

// An external input that does not match the turn's current durable pending
// state. Rejects the execution; nothing is appended.
export class TurnInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TurnInputError";
    }
}

// A live runtime dependency is missing or incompatible with the persisted
// snapshot. Rejects the execution; the turn is left unchanged so the caller
// can fix its environment and retry.
export class TurnDependencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TurnDependencyError";
    }
}
