/**
 * How the pop-out was left, per CHAT: which picture it held, and whether it was standing.
 *
 * The key is the chat that was on screen when the picture was popped out, not the character
 * whose gallery it came from and not the character being read. The window is furniture of
 * the story you are in, and a story is a chat: a character with six chats running is six
 * separate rooms, and a reference picture pinned up in one of them has no business
 * appearing in the other five. Same unit as the notepad's notes, for the same reason.
 *
 * The gallery it came from is kept alongside, because that is the only way to rebuild the
 * set the window pages through. That source is a library entry id and may be anybody, a
 * persona included, which is why nothing here filters on entry type. Key and source are
 * routinely different: the library is reachable from inside any chat, so opening someone
 * else's art while reading this story is an ordinary thing to do.
 *
 * Per-device, in localStorage, alongside the window's placement rather than on the settings
 * spine. The two records are halves of one answer (a window is a picture AND a rectangle),
 * and a rectangle is meaningless on another machine's screen, so sending half of it across
 * devices would make the pair disagree for no gain.
 *
 * Only the PATH is kept, never the set. The set is re-read from the source entry's live
 * gallery on the way back in, which is what makes an image deleted in the meantime a miss to
 * report rather than a stale name to render.
 *
 * Pure map operations here, storage below, so the trimming rules can be tested without a
 * browser. Same split as `floating-window.ts`.
 */

/** localStorage key. One record for every chat, not one key each. */
const MEMORY_KEY = 'image-popout-by-chat';

/**
 * What this record was keyed on before it was keyed on chats.
 *
 * Swept on the first read rather than migrated. A character-keyed record cannot be turned
 * into a chat-keyed one without guessing which of that character's chats the picture was
 * pinned up in, and guessing wrong puts a window in a story nobody opened it in, which is
 * the exact failure the chat key exists to prevent. Dropping it costs one reader one reopen;
 * keeping it around would leave a dead key in everyone's browser forever.
 */
const LEGACY_MEMORY_KEY = 'image-popout-by-character';

/**
 * How many chats are remembered. Insertion order is the recency order, so the oldest fall
 * off the front. A cap rather than a prune-against-the-chat-list, because the chat store is
 * not loaded when this file is read and a bound that needs another store is not a bound.
 * `pruneIn` below is the tighter sweep, run once the chat list is actually known.
 */
export const MEMORY_LIMIT = 20;

/**
 * What the window was showing, whether it was standing, and where the rest of its set can be
 * found again.
 *
 * Two facts, not one, and keeping them apart is what the three header buttons mean. A window
 * can be **up with nothing in it** (the reader minimised the picture away but wants the frame
 * there), and it can be **down with a picture still loaded** (put away from the title bar,
 * coming back to exactly what it held). Neither is expressible if a record only ever means
 * "there is a picture here", which is what this used to be.
 */
export interface RememberedPopout {
	/** Server-relative path of the image itself. Absent when the window is up and empty. */
	path?: string;
	/** The library entry whose gallery holds it, which need NOT be anyone in this chat.
	 *  Absent exactly when `path` is. */
	sourceId?: string;
	/** Whether the window itself is standing, independently of whether anything is loaded. */
	open: boolean;
}

/** Chat → the picture its pop-out was left on. */
export type PopoutMemory = Record<string, RememberedPopout>;

/**
 * `map` with `chatId` recorded as most recent, capped at `limit`.
 *
 * Re-inserted rather than assigned in place: assigning to an existing key keeps its original
 * position, so a story you return to daily would still age out behind ones you have not
 * opened in weeks.
 */
export function rememberIn(
	map: PopoutMemory,
	chatId: string,
	entry: RememberedPopout,
	limit = MEMORY_LIMIT
): PopoutMemory {
	const next: PopoutMemory = { ...map };
	delete next[chatId];
	next[chatId] = { ...entry };
	const keys = Object.keys(next);
	for (const stale of keys.slice(0, Math.max(keys.length - limit, 0))) delete next[stale];
	return next;
}

/** `map` without `chatId`. A new object either way, so callers never mutate a read. */
export function forgetIn(map: PopoutMemory, chatId: string): PopoutMemory {
	const next: PopoutMemory = { ...map };
	delete next[chatId];
	return next;
}

/**
 * `map` with every record whose chat no longer exists dropped.
 *
 * The cap above bounds this record; the prune is what keeps it HONEST, so a browser that
 * has been through a few hundred chats is not holding nineteen pictures for stories that
 * were deleted months ago. Deleting a chat is the event that makes a record unreachable,
 * since nothing can ever return to that story and ask, so nobody is owed a notice about it
 * and the row simply goes.
 *
 * Deliberately does NOT prune on the source entry. A record whose picture's gallery has been
 * deleted is still keyed on a chat the reader can walk back into, and when they do they are
 * owed the reason their window is not there: `reopenFor` looks the source up live, misses,
 * says so once and drops the record itself. Sweeping it here silently would take that notice
 * away and leave the window's disappearance unexplained.
 */
export function pruneIn(map: PopoutMemory, liveChatIds: ReadonlySet<string>): PopoutMemory {
	const next: PopoutMemory = {};
	for (const [chatId, entry] of Object.entries(map)) {
		if (liveChatIds.has(chatId)) next[chatId] = entry;
	}
	return next;
}

/** Every well-formed entry of the stored record, or an empty one when it is unreadable. */
export function readPopoutMemory(): PopoutMemory {
	try {
		// Cheap, idempotent, and the only place that knows the old key existed. Doing it on
		// read rather than behind a version flag means a browser that never opens another
		// pop-out still stops carrying it.
		localStorage.removeItem(LEGACY_MEMORY_KEY);
		const raw = localStorage.getItem(MEMORY_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: PopoutMemory = {};
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			const raw = (value ?? {}) as Partial<RememberedPopout>;
			// Half a picture is no picture: without the source there is no set to page through,
			// and reopening one image with no way back to its neighbours is a worse answer than
			// not reopening at all. So the pair survives together or not at all, which leaves
			// `open` as the other thing a record can be carrying.
			const hasImage =
				typeof raw.path === 'string' && raw.path && typeof raw.sourceId === 'string' && raw.sourceId;
			// Records written before the window could be standing empty carry no `open` at all,
			// and every one of them described a window that WAS up: that was the only state the
			// old shape could mean. Reading a missing flag as true is therefore the migration,
			// and it needs no version stamp and loses nothing.
			const open = typeof raw.open === 'boolean' ? raw.open : Boolean(hasImage);
			// A record that is neither standing nor holding a picture says nothing at all. It is
			// not written, and one that turns up hand-edited is dropped rather than kept as a row
			// that can never affect anything.
			if (!open && !hasImage) continue;
			out[id] = hasImage
				? { path: raw.path as string, sourceId: raw.sourceId as string, open }
				: { open };
		}
		return out;
	} catch {
		return {}; // unreadable or malformed, so nothing reopens rather than something wrong
	}
}

function writePopoutMemory(map: PopoutMemory): void {
	try {
		localStorage.setItem(MEMORY_KEY, JSON.stringify(map));
	} catch {
		/* storage unavailable, so the pop-out just will not survive a reload */
	}
}

export function rememberPopout(chatId: string, entry: RememberedPopout): void {
	writePopoutMemory(rememberIn(readPopoutMemory(), chatId, entry));
}

export function forgetPopout(chatId: string): void {
	writePopoutMemory(forgetIn(readPopoutMemory(), chatId));
}

/**
 * Drop every record whose chat is gone. Called with the live chat list, which is why it
 * lives here rather than running on read: this file is read before the chat store loads.
 *
 * Writes only when something actually goes, so the ordinary case (nothing to sweep) does
 * not touch storage on every chat-list change.
 */
export function prunePopoutMemory(liveChatIds: ReadonlySet<string>): void {
	const before = readPopoutMemory();
	const after = pruneIn(before, liveChatIds);
	if (Object.keys(after).length !== Object.keys(before).length) writePopoutMemory(after);
}
