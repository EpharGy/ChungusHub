/** Shared types for the Chungus Assistant server module. */

import type { SyncScope } from '../../shared/sync';

/**
 * The consent set a tool list / tool call runs under: the capability GROUPS the assistant
 * may reach (server/assistant/registry/groups.ts). Two versions exist per turn: the one the
 * session FROZE (which tools the model was offered) and the EFFECTIVE one (that, intersected
 * with the live setting). They differ only when the user switched a family off mid-session,
 * which bites at once; see server/assistant/sessionSettings.ts.
 */
export interface AssistantPermissions {
	/** Enabled group ids. Always-on families are in it by construction (`normalizeGroups`). */
	groups: ReadonlySet<string>;
}

/**
 * What one tool call can take away, as three ordered rungs. Every capability declares the rung
 * it sits on, a preview may only RAISE that rung once it has read the arguments, and the three
 * approval modes are thresholds on this same ladder. That is the whole safety policy: the mark
 * a row wears on the card and the decision to show the row at all are the same number, so a
 * call the card would paint as permanent can never be one the mode waved through.
 */
export type RiskClass =
	/** Changes nothing: a read, a search, pointing the user at a page. */
	| 'read'
	/** Writes something, and the card's diff shows what it replaced. */
	| 'write'
	/** Takes something away with nothing left naming it: a row, a variant, a portrait. */
	| 'delete';

const RISK_RANK: Record<RiskClass, number> = { read: 0, write: 1, delete: 2 };

/** Whether `risk` sits at or above `threshold` on the ladder. */
export function riskAtLeast(risk: RiskClass, threshold: RiskClass): boolean {
	return RISK_RANK[risk] >= RISK_RANK[threshold];
}

/** The higher of two rungs: how a preview raises a capability's declared floor, never lowers it. */
export function raiseRisk(floor: RiskClass, raised: RiskClass): RiskClass {
	return RISK_RANK[raised] > RISK_RANK[floor] ? raised : floor;
}

/**
 * How much the user wants to be asked before the assistant acts. Per TAB, never per
 * session-settings snapshot: approval is entirely the app's business, so it touches neither
 * the system prompt nor the tool list and changing it costs no prompt cache at all.
 *
 * Two answers to one question (see APPROVAL_THRESHOLD in loop.ts) and nothing in between:
 * a line the user can predict without knowing which tool the assistant happened to reach for.
 * The loop refuses a value outside this union rather than running unreviewed: this gate
 * degrades loud, never open.
 */
export type ApprovalMode =
	/** Everything that changes anything is shown first. Reads run untouched. */
	| 'manual'
	/** Nothing is asked, deletes included. */
	| 'auto';

/** One line of context on a pending call: a memory price, a branch warning, a save mode. */
export interface ApprovalNote {
	text: string;
	/** Renders as a warning rather than a plain fact. */
	warn?: boolean;
}

/** Something the assistant is about to touch, addressed the way the app addresses it, so a
 *  pending call can offer a look at its target while refusing is still free. */
export interface ApprovalTarget {
	kind: 'character' | 'persona' | 'message' | 'lorebook' | 'chat';
	id: string;
}

/**
 * One tool call as the approval card renders it, derived BEFORE the call runs. Everything
 * here is a prediction the capability itself makes (`Capability.preview`), which is the
 * whole point: the moment to say "not that one" is the moment before it happens.
 *
 * The split between the three text fields is what keeps a twenty-row card readable. `act` is
 * the deed without its target and `actNotes` are true of the deed alone, so rows repeating one
 * act state them ONCE; `label` and `notes` are this row's own, and are all that distinguishes
 * it from its neighbours. What is true of EVERY call (that none of it can be undone) is said
 * by neither: it belongs to the delete-class mark, not to a sentence on twenty rows.
 */
export interface ApprovalCall {
	/** The call's ordinal within this model step: how a decision addresses it. */
	index: number;
	tool: string;
	/** Which one: the target in the user's words ("Turn #42 · Aria"), never an id. */
	label: string;
	notes: ApprovalNote[];
	/** The deed without its target ("Delete message"), shared by every row that repeats it. */
	act?: string;
	/** What is true of the act itself, however many rows it covers. */
	actNotes?: ApprovalNote[];
	/** What it happens inside: a chat title, a lorebook name, a character. */
	within?: string;
	/** Position inside `within` (a chat turn), so a run of rows reads as a range. */
	at?: number;
	/** Where the target lives in the app, for the card's look-before-you-answer jump. */
	target?: ApprovalTarget;
	/** Before/after of a text write, so the card can show the change itself. */
	diff?: { before: string; after: string; title?: string };
	/** Where this call actually landed on the ladder once its arguments were read: the number
	 *  that decided the row is here, and the one the row's mark is drawn from. */
	risk: RiskClass;
	/** How many rows a bulk call would touch, so the card states the size it is approving. */
	rows?: number;
}

/** The user's answer to one approval card. Anything not approved is refused. */
export interface ApprovalOutcome {
	approved: number[];
}

/** One card, as the panel renders it. `askId` is the id every answer is matched against
 *  (the same field a question card carries, since a turn stops on one or the other). */
export interface ApprovalCard {
	askId: string;
	calls: ApprovalCall[];
}

/**
 * One multiple-choice question the assistant put to the user (`ask_user`). Each is its own
 * card in a series the user steps through; the free-text box every card carries is the
 * panel's, not the model's, which is why nothing here declares it.
 */
export interface AskQuestion {
	question: string;
	/** 2 to 4 distinct answers, each a real path. */
	options: string[];
	/** Several may be picked at once. Absent = exactly one. */
	multiple?: boolean;
}

/** One card of the series, as the panel renders it. */
export interface QuestionCard {
	askId: string;
	questions: AskQuestion[];
}

/** What the user answered one question with: options they picked, and whatever they typed.
 *  A single-choice question yields at most one pick, and a typed answer instead of it. */
export interface QuestionAnswer {
	picked: string[];
	written: string | null;
}

/** The whole series, answered in order. `stopped` = the user stopped the turn instead. */
export interface QuestionOutcome {
	answers: QuestionAnswer[];
	stopped?: boolean;
}

/** What a capability can say about a call it has not run yet. All fields optional: a tool
 *  with nothing useful to predict simply has no `preview`, and the card falls back to its
 *  name plus its arguments. */
export interface ApprovalPreview {
	label?: string;
	notes?: ApprovalNote[];
	act?: string;
	actNotes?: ApprovalNote[];
	within?: string;
	at?: number;
	target?: ApprovalTarget;
	diff?: { before: string; after: string; title?: string };
	rows?: number;
	/** Set by a tool whose rung depends on its ARGUMENTS (`Capability.escalates`), once it has
	 *  read them: a version action that deletes, a portrait write that replaces. It can only
	 *  ever RAISE the capability's declared floor, never lower it. */
	risk?: RiskClass;
}

/** Context threaded through every tool execution for one assistant turn. */
export interface AssistantContext {
	/** The EFFECTIVE permissions: a revoked one is already intersected out here. */
	permissions: AssistantPermissions;
	// No chatId: there is no ambient "current chat" a tool could fall back to. Every
	// chat-scoped tool takes an explicit id (requireChatId), and the turn's workspace note
	// carries the open chat's id for the model to pass.
	/** Broadcasts a live-sync hint so other clients refresh the touched scope. Typed to the
	 *  shared vocabulary, so a tool cannot broadcast something no client handles. */
	broadcast: (scope: SyncScope) => void;
	/** Whether the assistant's provider/model can receive images this turn: tools that
	 *  attach an image for the model to see fail loudly when it cannot. */
	sendImages?: boolean;
	/**
	 * Stops the turn and puts these questions to the user, resolving once they answer or stop.
	 * Only a real turn has a person on the other end, so it is absent in a preview or a smoke
	 * run and `ask_user` refuses loudly there rather than inventing an answer.
	 */
	ask?: (questions: AskQuestion[]) => Promise<QuestionOutcome>;
	/**
	 * The conversation's freshness claims (freshness-core.ts), LIVE for the whole turn: the
	 * loop seeds it from the context this request sends and folds each tool result's stamps
	 * back in as it lands, so a write's own re-stamp satisfies the overwrite gate on the
	 * very next call (assertClaimFresh, registry/util.ts). A ledger frozen at the turn's
	 * start would refuse the second write to a thing the first just re-stamped. Absent when
	 * no conversation stands behind the call (internal readers, direct dispatches), which
	 * disables the gate: no claim held means nothing read to protect.
	 */
	claims?: ReadonlyMap<string, string>;
	/**
	 * Every image the user has attached in this assistant tab, OLDEST FIRST. The model
	 * addresses them 1-based ("attachment 3"). The order is append-only (a user turn is
	 * never deleted), so a number written in one turn still means the same picture ten
	 * turns later. Together with the entry's own art, this is the entire set of images a
	 * tool may resolve; a model-supplied path never is.
	 */
	userImages?: string[];
	/** The tail of `userImages` attached to THIS turn: what a bare "attachment" means. */
	turnImages?: string[];
	/**
	 * The assistant tab this turn belongs to. Unlike a chat id, this is genuinely ambient
	 * (it is the conversation the tool is running inside, not a target the model chooses)
	 * and it scopes the attached-file reads, so a file attached to one tab can never be read
	 * from another. Absent where no conversation stands behind the call.
	 */
	assistantSessionId?: string;
	/**
	 * Estimated tokens the conversation still has before it hits the trim ceiling, asked
	 * LIVE: it is read at the moment of each call, so two reads in one model step cannot
	 * both spend the same room. Attached-file reads answer to it (registry/files.ts) rather
	 * than to a constant, because a result is persisted verbatim and a turn that outgrows
	 * the window cannot be trimmed apart again: the tab simply stops sending.
	 *
	 * Absent when nothing is being spent (a preview, the smoke script).
	 */
	roomTokens?: () => number;
}

/** What a single tool execution returns: a UI-facing summary + the model-facing JSON. */
export interface ToolOutcome {
	/** Structured result rendered in the assistant panel's action list. */
	uiResult: AssistantToolResult;
	/** JSON string fed back to the model as the tool message content. */
	toolMessage: string;
	/** Image paths the loop must attach to the conversation AFTER this iteration's
	 *  tool results, so the model actually sees them (tool messages are text-only). */
	injectImages?: string[];
}

/** One entry of a turn's chronological timeline, exactly as the client renders and
 *  persists it (steps_json). The loop assembles this server-side so the turn's
 *  transcript survives a dropped socket instead of depending on a client commit. */
export type AssistantStep =
	| { kind: 'text'; text: string }
	| { kind: 'thinking'; text: string }
	| { kind: 'tool'; tool: AssistantToolResult };

export interface AssistantToolResult {
	type: string;
	/** Short human label, e.g. "Created character: Aria". */
	label: string;
	/** Present on failures. */
	error?: string;
	/** Optional ids/names for the UI to link to. */
	id?: string;
	name?: string;
	[k: string]: unknown;
}
