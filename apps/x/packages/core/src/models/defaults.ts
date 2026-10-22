import z from "zod";
import { BackgroundScheduling, BACKGROUND_QUIET_PERIOD_MS, LlmModelConfig, LlmProvider, ModelSelection as ModelSelectionSchema, type TaskModelKey } from "@x/shared/dist/models.js";
import { IModelConfigRepo } from "./repo.js";
import container from "../di/container.js";

// THE canonical selection: provider + model + the effort picked with them,
// one value threaded from UI through IPC to run creation. Callers forward
// `effort` verbatim into run options; absent = Auto (send nothing).
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

async function readConfig(): Promise<z.infer<typeof LlmModelConfig> | null> {
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        return await repo.getConfig();
    } catch {
        // Fresh install before ensureConfig ran, or an unreadable file.
        return null;
    }
}

/**
 * The single source of truth for "what model+provider should we use when
 * the caller didn't specify and the agent didn't declare": the config's
 * assistantModel, period. It is written by onboarding / provider connect
 * (via initial selection) and by every model pick in the UI; hidden
 * fallback defaults were removed with the v2 config migration.
 */
export async function getDefaultModelAndProvider(): Promise<ModelSelection> {
    const cfg = await readConfig();
    const assistant = cfg?.assistantModel;
    if (!assistant) {
        throw new Error("No assistant model configured (connect a provider or sign in)");
    }
    return {
        model: assistant.model,
        provider: assistant.provider,
        ...(assistant.effort ? { effort: assistant.effort } : {}),
    };
}

/**
 * A resolved selection as headless-run options: the `effort` stored on the
 * selection travels as the run option `reasoningEffort`. Spread this instead
 * of the raw selection (whose `effort` key run options don't know).
 */
export function asRunModelOptions(selection: ModelSelection): {
    model: string;
    provider: string;
    reasoningEffort?: "low" | "medium" | "high";
} {
    return {
        model: selection.model,
        provider: selection.provider,
        ...(selection.effort ? { reasoningEffort: selection.effort } : {}),
    };
}

/**
 * How background model calls share the hardware with chat (settings select,
 * models.json `backgroundScheduling`). Read at every scheduling decision so a
 * change takes effect immediately.
 *
 * The fallback to the legacy `deferBackgroundTasks` flag happens here rather
 * than in migrateModelsConfig because it has to cover two shapes of stored
 * preference: v1 configs carry the flag forward through migration, and v2
 * files written before this setting existed carry it directly.
 */
export async function getBackgroundScheduling(): Promise<BackgroundScheduling> {
    const cfg = await readConfig();
    if (cfg?.backgroundScheduling) return cfg.backgroundScheduling;
    return cfg?.deferBackgroundTasks === true ? "immediate" : "off";
}

/**
 * Quiet period opportunistic background work waits for after a chat turn, or
 * null when scheduling is off and background calls may overlap the chat.
 * `immediate` is 0: still never concurrent with a turn, but no extra wait once
 * the turn settles.
 */
export async function getBackgroundQuietPeriodMs(): Promise<number | null> {
    const setting = await getBackgroundScheduling();
    if (setting === "off") return null;
    return BACKGROUND_QUIET_PERIOD_MS[setting] ?? 0;
}

/**
 * Resolve a provider instance id (as stored on a run, an agent, or returned
 * by getDefaultModelAndProvider) into the LlmProvider entry that
 * createProvider expects.
 *
 * - "rowboat" → gateway provider (auth via OAuth bearer; no creds field).
 * - "codex" → ChatGPT subscription (auth in chatgpt-auth.json).
 * - other ids → the models.json providers map.
 */
export async function resolveProviderConfig(name: string): Promise<z.infer<typeof LlmProvider>> {
    if (name === "rowboat") {
        return { flavor: "rowboat" };
    }
    if (name === "codex") {
        return { flavor: "codex" };
    }
    const cfg = await readConfig();
    const entry = cfg?.providers[name];
    if (!entry) {
        throw new Error(`Provider '${name}' is referenced but not configured`);
    }
    return entry;
}

/**
 * Per-task model resolution: the explicit taskModels override wins (with the
 * effort stored on it), else the assistant model+effort pair. No hidden
 * per-task defaults — the v2 migration materialized the historical curated
 * models as visible overrides.
 */
async function getCategoryModel(category: TaskModelKey): Promise<ModelSelection> {
    const cfg = await readConfig();
    const override = cfg?.taskModels?.[category];
    if (override) {
        return {
            model: override.model,
            provider: override.provider,
            ...(override.effort ? { effort: override.effort } : {}),
        };
    }
    return getDefaultModelAndProvider();
}

/**
 * Model used by knowledge-graph agents (note_creation, the email classifier,
 * etc.) when they're the top-level of a run.
 */
export async function getKgModel(): Promise<ModelSelection> {
    return getCategoryModel("knowledgeGraph");
}

/** Model used by the live-note agent + routing classifier. */
export async function getLiveNoteAgentModel(): Promise<ModelSelection> {
    return getCategoryModel("liveNoteAgent");
}

/** Model used by the auto-permission classifier. */
export async function getAutoPermissionDecisionModel(): Promise<ModelSelection> {
    return getCategoryModel("autoPermissionDecision");
}

/** Model used by the meeting-notes summarizer. */
export async function getMeetingNotesModel(): Promise<ModelSelection> {
    return getCategoryModel("meetingNotes");
}

/** Model used to auto-name chat sessions from the first user message. */
export async function getChatTitleModel(): Promise<ModelSelection> {
    return getCategoryModel("chatTitle");
}

/** Model used by the background-task agent + routing classifier. */
export async function getBackgroundTaskAgentModel(): Promise<ModelSelection> {
    return getCategoryModel("backgroundTask");
}

/**
 * Explicit subagent model override, or null to inherit the PARENT turn's
 * model (spawn-agent's default — which is the assistant for a top-level
 * chat). Not getCategoryModel: the no-override fallback is the parent, not
 * the assistant, and the caller owns that resolution.
 */
export async function getSubagentModelOverride(): Promise<ModelSelection | null> {
    const cfg = await readConfig();
    return cfg?.taskModels?.subagent ?? null;
}
