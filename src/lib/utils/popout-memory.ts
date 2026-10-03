/**
 * Which chats were left with their gallery window standing, per device.
 *
 * The picture itself is NOT here: it lives on the chat row (`feature_state.galleryPin`,
 * architecture/image-popout.md) because a reference pinned to a story is a fact about that
 * story and has to be there on the phone. What this file remembers is the one part of a
 * gallery window that is genuinely local: whether a frame is up on THIS screen. It sits in
 * localStorage beside that window's rectangle, because a window is a thing open AND a place
 * on a screen, and splitting that pair across the settings spine would let the halves
 * disagree about a monitor the other one has never seen.
 *
 * **That split is the whole of what this file is now, and it used to be missing.** The
 * record was one localStorage object per chat carrying the path, its source and the open
 * flag together, on the reasoning that a window's state is per-device. True of the frame and
 * false of the picture: a picture pinned on the desktop was invisible from the phone and the
 * other way round, silently, because a device with no record simply restores nothing. The
 * notepad had already made this split correctly, one branch over, citing this file as its
 * model for the half it kept local.
 *
 * A bare list of chat ids, most-recent-first, because presence is the whole record: the
 * second field this used to need went to the chat row with the picture. Order is the recency
 * order, so the oldest fall off the front.
 *
 * Pure list operations here, storage below, so the trimming rules can be tested without a
 * browser. Same split as `notepad-memory.ts` and `floating-window.ts`.
 */

/** localStorage key. One record for every chat, not one key each. */
const MEMORY_KEY = 'image-popout-open-chats';

/**
 * The shapes this record had before it was a list of ids, swept on read rather than migrated.
 *
 * `-by-character` predates the chat binding: turning one of those into a chat-keyed record
 * means guessing which of that character's chats the picture was pinned up in, and guessing
 * wrong puts a window in a story nobody opened it in.
 *
 * `-by-chat` is the one that held the picture as well as the flag. Its paths are not promoted
 * onto the chat rows they belong to, deliberately: a promotion has to run inside a loaded chat
 * to know which row to write, so it would land one story at a time over days, and the code
 * doing it could not be removed until every device had been through it. Dropping costs each
 * reader one re-pin per story they had one in; keeping it would park a migration in the
 * codebase with no way to tell when it was finished.
 *
 * Both are removed on read: cheap, idempotent, and it means a browser that never opens
 * another gallery window still stops carrying them.
 */
const LEGACY_KEYS = ['image-popout-by-character', 'image-popout-by-chat'] as const;

/**
 * How many chats are remembered. A cap rather than a prune-against-the-chat-list, because
 * this file is read before the chat store loads and a bound that needs another store is not
 * a bound. It is the guarantee this record can never grow: it is enforced on write, by a
 * file that needs nothing else to be working.
 *
 * `pruneIn` below is the tighter sweep, run once the chat list is actually known. The cap
 * makes the record BOUNDED; the prune is what keeps it honest, because twenty ids belonging
 * to twenty deleted chats is within the cap and is still twenty rows of nothing.
 */
export const MEMORY_LIMIT = 20;

/** Chat ids whose gallery window was left standing, oldest first. */
export type PopoutMemory = string[];

/**
 * `list` with `chatId` recorded as most recent, capped at `limit`.
 *
 * Re-appended rather than left in place: keeping an existing entry where it is would age out
 * a story you return to daily behind ones you have not opened in weeks.
 */
export function rememberIn(list: PopoutMemory, chatId: string, limit = MEMORY_LIMIT): PopoutMemory {
	const next = list.filter((id) => id !== chatId);
	next.push(chatId);
	return next.slice(Math.max(next.length - limit, 0));
}

/** `list` without `chatId`. A new array either way, so callers never mutate a read. */
export function forgetIn(list: PopoutMemory, chatId: string): PopoutMemory {
	return list.filter((id) => id !== chatId);
}

/**
 * `list` with every id whose chat no longer exists dropped.
 *
 * Deleting a chat is what makes an id here unreachable: nothing can return to that story and
 * ask whether its window should be standing, so nobody is owed a notice and the id simply
 * goes. The picture it referred to went with the chat row, since that is where it lived.
 */
export function pruneIn(list: PopoutMemory, liveChatIds: ReadonlySet<string>): PopoutMemory {
	return list.filter((id) => liveChatIds.has(id));
}

/** Every well-formed id of the stored record, or an empty one when it is unreadable. */
export function readPopoutMemory(): PopoutMemory {
	try {
		for (const key of LEGACY_KEYS) localStorage.removeItem(key);
		const raw = localStorage.getItem(MEMORY_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
	} catch {
		return []; // unreadable or malformed, so nothing reopens rather than something wrong
	}
}

function writePopoutMemory(list: PopoutMemory): void {
	try {
		localStorage.setItem(MEMORY_KEY, JSON.stringify(list));
	} catch {
		/* storage unavailable, so the window just will not survive a reload */
	}
}

/** Whether this chat's gallery window should come back up when the reader returns to it. */
export function isPopoutOpenFor(chatId: string): boolean {
	return readPopoutMemory().includes(chatId);
}

export function rememberPopoutOpen(chatId: string): void {
	writePopoutMemory(rememberIn(readPopoutMemory(), chatId));
}

export function forgetPopoutOpen(chatId: string): void {
	writePopoutMemory(forgetIn(readPopoutMemory(), chatId));
}

/**
 * Drop every id whose chat is gone. Called with the live chat list, which is why it lives
 * here rather than running on read: this file is read before the chat store loads.
 *
 * Writes only when something actually goes, so the ordinary case (nothing to sweep) does
 * not touch storage on every chat-list change.
 */
export function prunePopoutMemory(liveChatIds: ReadonlySet<string>): void {
	const before = readPopoutMemory();
	const after = pruneIn(before, liveChatIds);
	if (after.length !== before.length) writePopoutMemory(after);
}
