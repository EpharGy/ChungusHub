/**
 * EchoChamber domain types.
 *
 * EchoChamber generates a feed of audience reactions to the story: a Discord chat, a
 * Twitter thread, a news ticker. The model is asked for `username: message` lines, they
 * are parsed into records, and the feed is hung on the turn it reacted to.
 *
 * Everything here is deliberately free of Svelte and of `$lib`, so the parser and the
 * prompt builder stay unit-testable under `bun test` with no DOM and no network.
 *
 * **A reaction is stored as data, never as markup.** The extension this was ported from
 * saved its rendered HTML and re-parsed that HTML with `querySelectorAll` to recover the
 * messages. Storing the view means the feed can never be restyled, re-ordered or made
 * safe after the fact, and it puts model output back through an HTML parser on every
 * read. The port stores `Reaction[]` and renders it, and nothing may reintroduce a
 * stored-markup field.
 */

/** One parsed line of the feed: who said it, and what they said. */
export interface Reaction {
	/** The handle the model invented, already trimmed and length-capped. Never markup. */
	username: string;
	/** What they wrote. Markdown is applied at render time, not stored expanded. */
	text: string;
}

/**
 * A generated feed, filed against the message it reacted to.
 *
 * **Keyed by message id, not by position.** The extension keyed its saved commentary by
 * `chat.indexOf(msg)` — an index into a flat array. This app's chat is a tree, so an
 * index names a different turn on every branch, and a swipe silently re-points every
 * stored reaction at a message nobody wrote. A message id is stable across every branch
 * change, which is the whole reason the feed survives a swipe here and did not there.
 */
export interface EchoChamberFeed {
	/** The style that produced it, so a feed generated under a different one still reads right. */
	styleId: string;
	reactions: Reaction[];
	createdAt: number;
}

/**
 * A chat style: the personality of the feed.
 *
 * `prompt` is a complete system-prompt fragment (who the crowd is, how they write, and
 * the `username: message` output contract). Built-ins ship in `styles.ts`; a reader's own
 * styles ride the settings spine with the same shape, which is what lets one list hold
 * both.
 */
export interface ChatStyle {
	id: string;
	name: string;
	prompt: string;
	/**
	 * A style voiced by ONE persona (a narrator, a hype-bot) rather than a crowd. The
	 * user-count setting is meaningless for these — the count is a message count, and the
	 * speaker never varies — so the prompt builder collapses it to a single voice.
	 */
	narrator: boolean;
	/**
	 * The cast of the story speaks, instead of invented handles. Parsed names are snapped
	 * to the real cast and anything unrecognised is discarded, so a hallucinated character
	 * never reaches the feed.
	 */
	usesStoryCast: boolean;
	/** False for the shipped styles, true for anything the reader wrote. */
	custom: boolean;
}

/** Which end of the feed the newest reaction lands on. */
export type MessageOrder = 'newest-first' | 'oldest-first';

/**
 * Everything the reader configures, synced across devices on the `settings` spine under
 * one key. Nothing here is per-chat: a style and a crowd size describe the feed, not the
 * story.
 */
export interface EchoChamberSettings {
	/** Master switch. Off means nothing generates and the widget's launcher is hidden. */
	enabled: boolean;
	/** Generate as soon as a reply lands. Off leaves the feed to its own Generate button. */
	autoGenerate: boolean;
	/** Which style is live. Falls back to the first built-in if it names nothing. */
	styleId: string;
	/** How many reactions to ask for. Clamped by `BOUNDS`. */
	reactionCount: number;
	/**
	 * Feed the crowd the user's turns too, not just the reply being reacted to. Off is the
	 * cheap default: one turn in, a feed out.
	 */
	includeUserInput: boolean;
	/** How many turns of history to send when `includeUserInput` is on. */
	contextDepth: number;
	/** Send the active persona's description, so the crowd knows who it is watching. */
	includePersona: boolean;
	/** Send the bound character's description. */
	includeCharacterDescription: boolean;
	/** Send what the lorebook scan activated for this turn. */
	includeLorebook: boolean;
	/** Send the chat's memory recall, so a long story's crowd still knows the plot. */
	includeMemory: boolean;
	/** Show the crowd what it said last time, so a running joke can develop. */
	includePastReactions: boolean;
	messageOrder: MessageOrder;
}

/**
 * What the prompt builder needs to know about the story, gathered by the caller.
 *
 * The builder takes a plain snapshot rather than reaching for stores, which is what keeps
 * it pure: every field here is resolved by the store that has the app context, and the
 * builder just decides what reaches the model.
 */
export interface StoryContext {
	/** The turns to react to, oldest first, already filtered to the active path. */
	history: { role: 'user' | 'assistant'; content: string }[];
	personaName: string;
	personaDescription: string;
	characterDescriptions: { name: string; description: string }[];
	/** Rendered lorebook text for this turn, or empty. */
	lorebook: string;
	/** Rendered memory recall for this chat, or empty. */
	memory: string;
	/** The real cast, for `usesStoryCast` styles to snap parsed names against. */
	castNames: string[];
	/** Reactions already generated for turns in `history`, keyed by their index in it. */
	pastReactions: Record<number, Reaction[]>;
}
