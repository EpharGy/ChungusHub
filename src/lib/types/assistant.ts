/** Domain types for the Chungus Assistant panel (sessions + transcript). */

/**
 * How much a tab wants to be asked before the assistant acts. Mirrors the server's
 * `ApprovalMode` (server/assistant/types.ts). The two never import each other, and the
 * value rides each request rather than the session's frozen settings, because approval is
 * the app's business and the model is never told about it.
 */
export type ApprovalMode = 'manual' | 'auto';

import type { AssistantPendingAsk, AssistantToolResult } from '$lib/services/transport';
import type { SentAttachment } from '$shared/assistant-attachments';
import type { SettingsTab } from '$lib/config/settings-pages';

/** A saved assistant conversation (one "tab"/history entry). */
export interface AssistantSession {
	id: string;
	title: string;
	/** The roleplay chat the session most recently worked against (latest non-null turn
	 *  chatId, stamped server-side at commit). Lets history answer "which chat was this
	 *  about". null = never ran with a chat open; a deleted chat renders as nothing. */
	chatId?: string | null;
	createdAt: number;
	updatedAt: number;
	/** Turn count, computed by the server for the history list. */
	messageCount?: number;
}

/**
 * One item in an assistant turn's chronological timeline. The assistant runs a
 * read→act→observe loop, so a turn is a sequence of reply text and tool calls
 * interleaved in the order they actually happened, not two separate buckets.
 */
export type AssistantStep =
	| { kind: 'text'; text: string }
	| { kind: 'thinking'; text: string }
	| { kind: 'tool'; tool: AssistantToolResult };

/** One turn in an assistant conversation. */
export interface AssistantMessage {
	id: string;
	sessionId: string;
	role: 'user' | 'assistant';
	/** User text, or the assistant's concatenated reply text (kept for titles/legacy). */
	content: string;
	/** Chronological timeline of reply text + tool calls (assistant role only). */
	steps?: AssistantStep[];
	/** Legacy flat tool list: only present on pre-timeline persisted messages. */
	actions?: AssistantToolResult[];
	/** Images the user attached to this turn (server-relative paths; user role only). */
	images?: string[];
	/** What rode along with this user turn, each with the mode the server RESOLVED it to.
	 *  Written by the loop once the workspace note is built, never by this client, so the
	 *  bubble's chips state what happened rather than what the composer intended. */
	attachments?: SentAttachment[];
	/** Set when the turn failed. */
	error?: string;
	/**
	 * Where the turn stands. Absent = finished, the only state a transcript normally holds.
	 * `running` marks the row the server is still writing: it is rendered live from the
	 * session's runtime slot, so the transcript skips it. `interrupted` marks a turn whose
	 * server died mid-flight: the steps it did finish stand, and it is deliberately NOT
	 * retryable, because re-running it would repeat every mutation it already made.
	 */
	status?: 'running' | 'interrupted';
	/** Token spend of the whole turn, summed across the loop's iterations. The two extras
	 *  ride inside usage_json to avoid a schema migration: `contextTokens` is the last
	 *  iteration's prompt+completion (≈ the tab's current context, drives the meter) and
	 *  `capped` marks a turn that ended at the step/action budget (drives Continue). */
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cachedTokens?: number;
		contextTokens?: number;
		capped?: boolean;
	};
	createdAt: number;
}

/**
 * A workspace item attached to an assistant turn as context: auto-attached from what
 * the user currently has open (the active chat, the library entry in the
 * editor) or added by hand. The server resolves `refId` to the live data and
 * injects it so the assistant already has it without a tool call.
 */
export interface AssistantAttachment {
	kind: 'chat' | 'entry' | 'selection' | 'lorebook';
	/** chatId for a chat/selection; library entry id for a character/persona; book id for a lorebook. */
	refId: string;
	/** Which kind of library entry (entry attachments only). */
	entryType?: 'character' | 'persona';
	/** Display label: chat title, entry name, or the selection summary. */
	label: string;
	/** Thumbnail URL for entry portraits (used in the attach picker); absent for chats. */
	imageUrl?: string;
	/**
	 * ASKS the server to inject this item's full data (true) instead of a pointer the
	 * assistant reads on demand (false). Auto-attached open items are pointers; items the
	 * user added by hand ask for full. The server decides what actually goes (the size
	 * limit, the already-in-context check, and the chats-stay-pointers rule all live in
	 * its note builder) and stamps the outcome on the sent message (`SentAttachment`).
	 */
	full?: boolean;
	/**
	 * Present only for kind 'selection': the text the user highlighted in the chat and
	 * the message it anchors to, so the assistant is pointed at the exact spot to read around
	 * or edit instead of the whole chat.
	 */
	selection?: {
		anchorMessageId: string;
		text: string;
		truncated?: boolean;
		spanCount?: number;
	};
}

/** Stable identity for an attachment, for dedupe/dismissal. */
export function attachmentKey(a: AssistantAttachment): string {
	if (a.kind === 'selection' && a.selection) {
		// A selection's identity is the PASSAGE, not the chat: its refId is the chat id,
		// so keying on that alone would make muting one highlight silently mute every
		// future highlight in the same chat.
		return `selection:${a.refId}:${a.selection.anchorMessageId}:${hashText(a.selection.text)}`;
	}
	return `${a.kind}:${a.refId}`;
}

/** Tiny stable text hash (djb2). Distinguishes selections sharing an anchor message. */
function hashText(text: string): string {
	let h = 5381;
	for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

/**
 * A tool call whose arguments the model is still writing: the row the panel shows before
 * the call has run. Deliberately NOT an `AssistantStep`: a call with no result has nothing
 * to persist, and the turn's step array is exactly what the server commits.
 */
export interface AssistantRunningTool {
	/** The call's ordinal within the current model step; progress frames repeat it. */
	index: number;
	/** The tool's name. The icon and the row's label come from it. */
	name: string;
	/** One display line of the longest text the call is writing, derived server-side.
	 *  Empty when the arguments are ids/enums/numbers with nothing worth watching. */
	text: string;
}

/** Live state of a turn in flight, kept per session so tabs run concurrently. */
export interface AssistantSessionRuntime {
	busy: boolean;
	/** The turn's timeline as it streams in, in chronological order. */
	steps: AssistantStep[];
	iteration: number;
	/**
	 * Tool calls whose arguments are streaming right now, in call order. Each one becomes
	 * the finished tool step when its result lands, so a call is never two rows. Cleared
	 * when the model step ends (ordinals restart) and when the turn settles.
	 */
	running: AssistantRunningTool[];
	/**
	 * The card this turn has STOPPED on: calls waiting to be allowed to run, or questions the
	 * assistant asked. Unlike everything else here it is not a stream of deltas: it stands
	 * until someone answers it or stops the turn, on this device or another one. One slot,
	 * because a turn can only ever be waiting on one of them. null = nothing is waiting.
	 */
	pending: AssistantPendingAsk | null;
}

/**
 * A place in the app the assistant can deep-link the user to: the `nav` field a
 * `navigate` tool result carries. The client routes to it and flashes the target.
 */
export type NavTarget =
	| { kind: 'setting'; id: string; label: string; tab: SettingsTab; anchor: string }
	| { kind: 'entry'; id: string; entryType: 'character' | 'persona'; label: string }
	| { kind: 'message'; chatId: string; messageId: string; label: string }
	| { kind: 'chat'; id: string; label: string };
