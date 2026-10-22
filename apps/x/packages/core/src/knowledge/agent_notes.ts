import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { runWhenPossible } from '../runtime/assembly/headless-app.js';
import { asRunModelOptions, getKgModel } from '../models/defaults.js';
import { getErrorDetails } from '../application/lib/errors.js';
import { backgroundScheduler } from '../application/lib/background-scheduler.js';
import { serviceLogger } from '../services/service_logger.js';
import { loadUserConfig, updateUserEmail } from '../config/user_config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { gmailRateLimitCooldownMs } from './gmail-rate-limit.js';
import {
    loadAgentNotesState,
    saveAgentNotesState,
    markEmailProcessed,
    markRunProcessed,
    type AgentNotesState,
} from './agent_notes_state.js';

const SYNC_INTERVAL_MS = 10 * 1000; // how often a pass is REQUESTED, not when it runs
const EMAIL_BATCH_SIZE = 5;
const RUNS_BATCH_SIZE = 5;
const GMAIL_SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const RUNS_DIR = path.join(WorkDir, 'runs');
const AGENT_NOTES_DIR = path.join(WorkDir, 'knowledge', 'Agent Notes');
const INBOX_FILE = path.join(AGENT_NOTES_DIR, 'inbox.md');
const AGENT_ID = 'agent_notes_agent';

// --- File helpers ---

function ensureAgentNotesDir(): void {
    if (!fs.existsSync(AGENT_NOTES_DIR)) {
        fs.mkdirSync(AGENT_NOTES_DIR, { recursive: true });
    }
}

// --- Email scanning ---

function findUserSentEmails(
    state: AgentNotesState,
    userEmail: string,
    limit: number,
): string[] {
    if (!fs.existsSync(GMAIL_SYNC_DIR)) {
        return [];
    }

    const results: { path: string; mtime: number }[] = [];
    const userEmailLower = userEmail.toLowerCase();

    function traverse(dir: string) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                if (entry !== 'attachments') {
                    traverse(fullPath);
                }
            } else if (stat.isFile() && entry.endsWith('.md')) {
                if (state.processedEmails[fullPath]) {
                    continue;
                }

                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const fromLines = content.match(/^### From:.*$/gm);
                    if (fromLines?.some(line => line.toLowerCase().includes(userEmailLower))) {
                        results.push({ path: fullPath, mtime: stat.mtimeMs });
                    }
                } catch {
                    continue;
                }
            }
        }
    }

    traverse(GMAIL_SYNC_DIR);

    results.sort((a, b) => b.mtime - a.mtime);
    return results.slice(0, limit).map(r => r.path);
}

function extractUserPartsFromEmail(content: string, userEmail: string): string | null {
    const userEmailLower = userEmail.toLowerCase();
    const sections = content.split(/^---$/m);
    const userSections: string[] = [];

    for (const section of sections) {
        const fromMatch = section.match(/^### From:.*$/m);
        if (fromMatch && fromMatch[0].toLowerCase().includes(userEmailLower)) {
            userSections.push(section.trim());
        }
    }

    return userSections.length > 0 ? userSections.join('\n\n---\n\n') : null;
}

// --- Inbox reading ---

interface InboxSnapshot {
    entries: string[];
    /**
     * Total lines seen at read time — the acknowledge boundary used by
     * clearInbox. Counted before filtering blanks so the index lines up with
     * what clearInbox re-reads.
     */
    lines: number;
}

function readInbox(): InboxSnapshot {
    if (!fs.existsSync(INBOX_FILE)) {
        return { entries: [], lines: 0 };
    }
    const lines = fs.readFileSync(INBOX_FILE, 'utf-8').split('\n');
    return { entries: lines.filter(l => l.trim()), lines: lines.length };
}

/**
 * Acknowledge only the lines this pass actually read.
 *
 * save-to-memory appends one line at a time, and the pass snapshots its input
 * before the model call and acknowledges after it returns. With opportunistic
 * scheduling that window is minutes rather than seconds, so clearing the whole
 * file would silently discard notes the agent saved while the consolidation
 * run was queued or in flight. Anything appended after the snapshot stays for
 * the next pass.
 */
function clearInbox(consumedLines: number): void {
    if (consumedLines <= 0 || !fs.existsSync(INBOX_FILE)) {
        return;
    }
    const remaining = fs
        .readFileSync(INBOX_FILE, 'utf-8')
        .split('\n')
        .slice(consumedLines)
        .join('\n')
        .trim();
    fs.writeFileSync(INBOX_FILE, remaining ? `${remaining}\n` : '');
}

// --- Copilot run scanning ---

function findNewCopilotRuns(state: AgentNotesState): string[] {
    if (!fs.existsSync(RUNS_DIR)) {
        return [];
    }

    const results: string[] = [];
    const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
        if (state.processedRuns[file]) {
            continue;
        }

        try {
            const fullPath = path.join(RUNS_DIR, file);
            const fd = fs.openSync(fullPath, 'r');
            const buf = Buffer.alloc(512);
            const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
            fs.closeSync(fd);

            const firstLine = buf.subarray(0, bytesRead).toString('utf-8').split('\n')[0];
            const event = JSON.parse(firstLine);
            if (event.agentName === 'copilot') {
                results.push(file);
            }
        } catch {
            continue;
        }
    }

    results.sort();
    return results;
}

function extractConversationMessages(runFilePath: string): { role: string; text: string }[] {
    const messages: { role: string; text: string }[] = [];
    try {
        const content = fs.readFileSync(runFilePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                if (event.type !== 'message') continue;

                const msg = event.message;
                if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;

                let text = '';
                if (typeof msg.content === 'string') {
                    text = msg.content.trim();
                } else if (Array.isArray(msg.content)) {
                    text = msg.content
                        .filter((p: { type: string }) => p.type === 'text')
                        .map((p: { text: string }) => p.text)
                        .join('\n')
                        .trim();
                }

                if (text) {
                    messages.push({ role: msg.role, text });
                }
            } catch {
                continue;
            }
        }
    } catch {
        // ignore
    }
    return messages;
}

// --- User email resolution ---

// The processing loop ticks every 10s; until the profile fetch succeeds once
// (it persists into user config and is never needed again) each tick would
// re-hit Gmail — during a rate-limit lockout that both burned quota and kept
// re-arming the cooldown. Attempt at most every 15 minutes, never during a
// lockout.
let lastProfileAttemptAt = 0;
const PROFILE_RETRY_MS = 15 * 60_000;

async function ensureUserEmail(): Promise<string | null> {
    const existing = loadUserConfig();
    if (existing?.email) {
        return existing.email;
    }

    if (gmailRateLimitCooldownMs() > 0) return null;
    if (Date.now() - lastProfileAttemptAt < PROFILE_RETRY_MS) return null;
    lastProfileAttemptAt = Date.now();

    // Try direct Google OAuth (covers both BYOK and rowboat modes)
    try {
        const auth = await GoogleClientFactory.getClient();
        if (auth) {
            const gmail = GoogleClientFactory.gmailClient(auth);
            const profile = await gmail.users.getProfile({ userId: 'me' });
            if (profile.data.emailAddress) {
                updateUserEmail(profile.data.emailAddress);
                console.log(`[AgentNotes] Auto-populated user email: ${profile.data.emailAddress}`);
                return profile.data.emailAddress;
            }
        }
    } catch (error) {
        console.log('[AgentNotes] Could not fetch Gmail profile for user email:', error instanceof Error ? error.message : error);
    }

    return null;
}

// --- Main processing ---

async function processAgentNotes(): Promise<void> {
    ensureAgentNotesDir();
    const state = loadAgentNotesState();
    const userEmail = await ensureUserEmail();

    // Collect all source material
    const messageParts: string[] = [];

    // 1. Emails (only if we have user email)
    const emailPaths = userEmail
        ? findUserSentEmails(state, userEmail, EMAIL_BATCH_SIZE)
        : [];
    if (emailPaths.length > 0) {
        messageParts.push(`## Emails sent by the user\n`);
        for (const p of emailPaths) {
            const content = fs.readFileSync(p, 'utf-8');
            const userParts = extractUserPartsFromEmail(content, userEmail!);
            if (userParts) {
                messageParts.push(`---\n${userParts}\n---\n`);
            }
        }
    }

    // 2. Inbox entries
    const inbox = readInbox();
    if (inbox.entries.length > 0) {
        messageParts.push(`## Notes from the assistant (save-to-memory inbox)\n`);
        messageParts.push(inbox.entries.join('\n'));
    }

    // 3. Copilot conversations
    const newRuns = findNewCopilotRuns(state);
    const runsToProcess = newRuns.slice(-RUNS_BATCH_SIZE);
    if (runsToProcess.length > 0) {
        let conversationText = '';
        for (const runFile of runsToProcess) {
            const messages = extractConversationMessages(path.join(RUNS_DIR, runFile));
            if (messages.length === 0) continue;
            conversationText += `\n--- Conversation ---\n`;
            for (const msg of messages) {
                conversationText += `${msg.role}: ${msg.text}\n\n`;
            }
        }
        if (conversationText.trim()) {
            messageParts.push(`## Recent copilot conversations\n${conversationText}`);
        }
    }

    // Nothing to process
    if (messageParts.length === 0) {
        return;
    }

    const serviceRun = await serviceLogger.startRun({
        service: 'agent_notes',
        message: 'Processing agent notes',
        trigger: 'timer',
    });

    try {
        const timestamp = new Date().toISOString();
        const message = `Current timestamp: ${timestamp}\n\nProcess the following source material and update the Agent Notes folder accordingly.\n\n${messageParts.join('\n\n')}`;

        await runWhenPossible({
            agentId: AGENT_ID,
            message,
            useCase: 'knowledge_sync',
            subUseCase: 'agent_notes',
            ...asRunModelOptions(await getKgModel()),
            throwOnError: true,
        });

        // Mark everything as processed
        for (const p of emailPaths) {
            markEmailProcessed(p, state);
        }
        for (const r of newRuns) {
            markRunProcessed(r, state);
        }
        if (inbox.entries.length > 0) {
            clearInbox(inbox.lines);
        }

        state.lastRunTime = new Date().toISOString();
        saveAgentNotesState(state);

        await serviceLogger.log({
            type: 'run_complete',
            service: serviceRun.service,
            runId: serviceRun.runId,
            level: 'info',
            message: 'Agent notes processing complete',
            durationMs: Date.now() - serviceRun.startedAt,
            outcome: 'ok',
            summary: {
                emails: emailPaths.length,
                inboxEntries: inbox.entries.length,
                copilotRuns: runsToProcess.length,
            },
        });
    } catch (error) {
        console.error('[AgentNotes] Error processing:', error);
        await serviceLogger.log({
            type: 'error',
            service: serviceRun.service,
            runId: serviceRun.runId,
            level: 'error',
            message: 'Error processing agent notes',
            error: getErrorDetails(error),
        });
        await serviceLogger.log({
            type: 'run_complete',
            service: serviceRun.service,
            runId: serviceRun.runId,
            level: 'error',
            message: 'Agent notes processing failed',
            durationMs: Date.now() - serviceRun.startedAt,
            outcome: 'error',
        });
    }
}

// --- Entry point ---

/** One coalesced consolidation pass, deduplicated by this key. */
const JOB_KEY = 'knowledge:agent_notes';

/**
 * Request a consolidation pass.
 *
 * The poll only ever *requests* work. A pass already queued or in flight
 * absorbs the request instead of stacking a second full agent turn behind it,
 * so ten save-to-memory notes while you chat become one pending consolidation
 * rather than ten — which matters because each pass is a whole agent turn of
 * work triggered by a single appended bullet.
 */
function requestAgentNotesSync(): void {
    backgroundScheduler.enqueue(JOB_KEY, processAgentNotes);
}

export async function init() {
    console.log('[AgentNotes] Starting Agent Notes Service...');
    console.log(`[AgentNotes] Will check for new material every ${SYNC_INTERVAL_MS / 1000} seconds`);

    requestAgentNotesSync();

    // Polling stays. An empty poll never reaches the model — the processor
    // returns when there is nothing new — so now that model access is gated,
    // this interval no longer decides when GPU work starts. Replacing it with
    // a write-time signal is a responsiveness change, not a contention one,
    // and keeps its value as a reconciliation path for missed changes.
    while (true) {
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
        try {
            requestAgentNotesSync();
        } catch (error) {
            console.error('[AgentNotes] Error in main loop:', error);
        }
    }
}
