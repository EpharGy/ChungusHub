/**
 * Where a generated feed lives, and how it is kept from outliving what it reacted to.
 *
 * Feeds ride `chats.feature_state`, the per-chat opaque JSON blob the app already keeps for
 * per-chat feature state, read and written through `chatStore.updateChatFeatureState`'s
 * serialized read-merge-write. That choice buys three things this port would otherwise
 * have to build:
 *
 * - **No migration.** Nothing is appended to `MIGRATIONS`, so the port can never collide
 *   with an upstream schema version - the same rule the imagegen port holds.
 * - **Deletion is free and cannot be forgotten.** `feature_state` is a column on the chats
 *   row and `deleteChat` is a `DELETE FROM chats`, so a deleted chat takes its feeds with
 *   it atomically. Compare `steering_notes` in that same function: a separate table with no
 *   FK, which therefore needs an explicit reap that somebody has to remember to write.
 * - **It syncs on `chats`, not on `settings`.** A feed written per turn on the global
 *   settings spine would rewrite one blob for every chat there is and make every other
 *   device re-read every synced setting, per reply.
 *
 * What it costs is size: the blob is rewritten whenever a feed changes, so it must stay
 * small. Two rules keep it that way, and both live in `putFeed`.
 */

import type { EchoChamberFeed, Reaction } from './types';

/**
 * How many feeds one chat keeps.
 *
 * The blob is rewritten on every generation, so this is a size ceiling rather than a
 * history: at the default six reactions a feed is well under a kilobyte, and twenty-five of
 * them is a blob small enough to write per turn without thinking about it. Scrolling far
 * enough back shows turns whose feed has aged out, which is the intended trade - a feed is
 * decoration, and regenerating one is a button.
 */
export const MAX_STORED_FEEDS = 25;

/** Per-chat EchoChamber state, as it sits inside `ChatFeatureState`. */
export interface EchoChamberChatState {
	/**
	 * Feeds by the id of the message they reacted to.
	 *
	 * **By id, never by position.** The extension keyed its saved commentary by an index
	 * into a flat message array, which on a tree names a different turn on every branch: one
	 * swipe and every stored reaction points at a message nobody wrote.
	 */
	feeds: Record<string, EchoChamberFeed>;
}

export function defaultEchoChamberChatState(): EchoChamberChatState {
	return { feeds: {} };
}

function normalizeReaction(raw: unknown): Reaction | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.username !== 'string' || typeof obj.text !== 'string') return null;
	if (!obj.username.trim() || !obj.text.trim()) return null;
	return { username: obj.username, text: obj.text };
}

function normalizeFeed(raw: unknown): EchoChamberFeed | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	const reactions = Array.isArray(obj.reactions)
		? obj.reactions.map(normalizeReaction).filter((r): r is Reaction => r !== null)
		: [];
	// A feed with nothing left in it is not worth a slot: it renders as an empty panel and
	// occupies a place another turn's reactions could have had.
	if (reactions.length === 0) return null;

	return {
		styleId: typeof obj.styleId === 'string' ? obj.styleId : '',
		reactions,
		createdAt: typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : 0
	};
}

/**
 * Parse and sanitize the EchoChamber slice of a chat's feature state.
 *
 * Follows the contract the rest of `ChatFeatureState` holds: anything corrupt, missing or
 * of the wrong type degrades to the default rather than throwing, because a bad blob must
 * never be able to fail a chat read. A feed is decoration; losing one is not worth a chat
 * that will not open.
 */
export function normalizeEchoChamberChatState(raw: unknown): EchoChamberChatState {
	if (!raw || typeof raw !== 'object') return defaultEchoChamberChatState();
	const obj = raw as Record<string, unknown>;
	if (!obj.feeds || typeof obj.feeds !== 'object') return defaultEchoChamberChatState();

	const feeds: Record<string, EchoChamberFeed> = {};
	for (const [messageId, value] of Object.entries(obj.feeds as Record<string, unknown>)) {
		if (!messageId) continue;
		const feed = normalizeFeed(value);
		if (feed) feeds[messageId] = feed;
	}
	return { feeds };
}

/**
 * Drop feeds whose message is gone, then drop the oldest until the cap is met.
 *
 * The first half is what stops a leak the storage choice does not close on its own: a chat
 * being deleted takes its feeds with it, but deleting a *message* (or a whole subtree, via
 * a branch delete) leaves the feed that reacted to it behind, addressed to an id nothing
 * resolves. Those entries are invisible, never rendered, and would otherwise sit in the
 * blob for the life of the chat, holding slots that live turns should have.
 *
 * `liveMessageIds` is every message in the chat, not just the active path: a turn on
 * another branch is not deleted, it is just not being looked at, and its feed is waiting
 * for the reader to walk back to it.
 */
export function pruneFeeds(
	state: EchoChamberChatState,
	liveMessageIds: Iterable<string>
): EchoChamberChatState {
	const live = liveMessageIds instanceof Set ? liveMessageIds : new Set(liveMessageIds);

	const surviving = Object.entries(state.feeds).filter(([messageId]) => live.has(messageId));
	if (surviving.length <= MAX_STORED_FEEDS) {
		return surviving.length === Object.keys(state.feeds).length
			? state
			: { feeds: Object.fromEntries(surviving) };
	}

	// Newest first, then keep the cap's worth. `createdAt` is a write time rather than a
	// story position, which is exactly right here: the cap is about which feeds a reader has
	// most recently seen generated, not about where they sit in the tree.
	surviving.sort(([, a], [, b]) => b.createdAt - a.createdAt);
	return { feeds: Object.fromEntries(surviving.slice(0, MAX_STORED_FEEDS)) };
}

/**
 * File a feed against a message, pruning in the same pass.
 *
 * Pruning on write rather than on a sweep is deliberate: this is the only moment the blob
 * is being rewritten anyway, so the cleanup costs nothing extra, and there is no background
 * job to schedule, forget, or race against a chat that is not loaded.
 */
export function putFeed(
	state: EchoChamberChatState,
	messageId: string,
	feed: EchoChamberFeed,
	liveMessageIds: Iterable<string>
): EchoChamberChatState {
	const live = liveMessageIds instanceof Set ? liveMessageIds : new Set(liveMessageIds);
	// The message being filed against is live by definition - it is the turn just reacted
	// to - but a caller reading a stale path snapshot should not be able to drop it.
	live.add(messageId);

	const next = pruneFeeds({ feeds: { ...state.feeds, [messageId]: feed } }, live);
	return next;
}

/** Forget one message's feed, for a reader who wants it regenerated from nothing. */
export function clearFeed(state: EchoChamberChatState, messageId: string): EchoChamberChatState {
	if (!(messageId in state.feeds)) return state;
	const feeds = { ...state.feeds };
	delete feeds[messageId];
	return { feeds };
}
