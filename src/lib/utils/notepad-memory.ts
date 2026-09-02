/**
 * Which chats were left with their notepad window open, per device.
 *
 * The notes themselves are NOT here: they live on the chat row (`feature_state.notepad`,
 * architecture/notepad.md) because they are the reader's writing and have to reach every
 * device. What this file remembers is the one part of a notepad that is genuinely local:
 * whether a window is standing on THIS screen. It sits in localStorage beside that
 * window's rectangle for the same reason the pop-out's does: a window is a thing open AND a
 * place on a screen, and splitting that pair across the settings spine would let the halves
 * disagree about a monitor the other one has never seen.
 *
 * A bare list of chat ids, most-recent-first, because presence is the whole record: there is
 * no second field, unlike the pop-out's, which needs the gallery its picture came from. Order
 * is the recency order, so the oldest fall off the front.
 *
 * Pure list operations here, storage below, so the trimming rule can be tested without a
 * browser. Same split as `popout-memory.ts` and `floating-window.ts`.
 */

/** localStorage key. One record for every chat, not one key each. */
const MEMORY_KEY = 'notepad-open-chats';

/**
 * How many chats are remembered. A cap rather than a prune-against-the-chat-list, because
 * this file is read before the chat store loads and a bound that needs another store is not
 * a bound. A chat deleted while its id sits here costs nothing: the id is simply never asked
 * about again, and ages out.
 */
export const MEMORY_LIMIT = 20;

/** Chat ids whose notepad was left open, oldest first. */
export type NotepadMemory = string[];

/**
 * `list` with `chatId` recorded as most recent, capped at `limit`.
 *
 * Re-appended rather than left in place: keeping an existing entry where it is would age out
 * a story you return to daily behind ones you have not opened in weeks.
 */
export function rememberIn(list: NotepadMemory, chatId: string, limit = MEMORY_LIMIT): NotepadMemory {
	const next = list.filter((id) => id !== chatId);
	next.push(chatId);
	return next.slice(Math.max(next.length - limit, 0));
}

/** `list` without `chatId`. A new array either way, so callers never mutate a read. */
export function forgetIn(list: NotepadMemory, chatId: string): NotepadMemory {
	return list.filter((id) => id !== chatId);
}

/** Every well-formed id of the stored record, or an empty one when it is unreadable. */
export function readNotepadMemory(): NotepadMemory {
	try {
		const raw = localStorage.getItem(MEMORY_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
	} catch {
		return []; // unreadable or malformed, so nothing reopens rather than something wrong
	}
}

function writeNotepadMemory(list: NotepadMemory): void {
	try {
		localStorage.setItem(MEMORY_KEY, JSON.stringify(list));
	} catch {
		/* storage unavailable, so the window just will not survive a reload */
	}
}

/** Whether this chat's notepad should come back up when the reader returns to it. */
export function isNotepadOpenFor(chatId: string): boolean {
	return readNotepadMemory().includes(chatId);
}

export function rememberNotepadOpen(chatId: string): void {
	writeNotepadMemory(rememberIn(readNotepadMemory(), chatId));
}

export function forgetNotepadOpen(chatId: string): void {
	writeNotepadMemory(forgetIn(readNotepadMemory(), chatId));
}
