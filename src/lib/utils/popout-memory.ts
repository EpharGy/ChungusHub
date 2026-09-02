/**
 * Which picture the pop-out was left showing, per character being READ.
 *
 * The key is the character whose chat was open when the picture was popped out, not the
 * character whose gallery it came from. Those are routinely different: the library is
 * reachable from inside any chat, so opening someone else's art while reading this story is
 * an ordinary thing to do, and the window is a fixture of the story you are in rather than a
 * property of the picture. Switching stories therefore always puts the window away, and
 * coming back always brings it out, whoever the picture belongs to.
 *
 * The gallery it came from is kept alongside, because that is the only way to rebuild the
 * set the window pages through. Both ids are library entry ids; the source may be a persona,
 * which is why nothing here filters on entry type.
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
 * Pure map operations here, storage below, so the trimming rule can be tested without a
 * browser. Same split as `floating-window.ts`.
 */

/** localStorage key. One record for every character, not one key each. */
const MEMORY_KEY = 'image-popout-by-character';

/**
 * How many characters are remembered. Insertion order is the recency order, so the oldest
 * fall off the front. A cap rather than a prune-against-the-library, because the library is
 * not loaded when this file is read and a bound that needs another store is not a bound.
 */
export const MEMORY_LIMIT = 20;

/** What the window was showing, and where the rest of its set can be found again. */
export interface RememberedPopout {
	/** Server-relative path of the image itself. */
	path: string;
	/** The library entry whose gallery holds it, which need NOT be the character keyed on. */
	sourceId: string;
}

/** Character being read → the picture their pop-out was left on. */
export type PopoutMemory = Record<string, RememberedPopout>;

/**
 * `map` with `characterId` recorded as most recent, capped at `limit`.
 *
 * Re-inserted rather than assigned in place: assigning to an existing key keeps its original
 * position, so a character you return to daily would still age out behind ones you have not
 * opened in weeks.
 */
export function rememberIn(
	map: PopoutMemory,
	characterId: string,
	entry: RememberedPopout,
	limit = MEMORY_LIMIT
): PopoutMemory {
	const next: PopoutMemory = { ...map };
	delete next[characterId];
	next[characterId] = { ...entry };
	const keys = Object.keys(next);
	for (const stale of keys.slice(0, Math.max(keys.length - limit, 0))) delete next[stale];
	return next;
}

/** `map` without `characterId`. A new object either way, so callers never mutate a read. */
export function forgetIn(map: PopoutMemory, characterId: string): PopoutMemory {
	const next: PopoutMemory = { ...map };
	delete next[characterId];
	return next;
}

/** Every well-formed entry of the stored record, or an empty one when it is unreadable. */
export function readPopoutMemory(): PopoutMemory {
	try {
		const raw = localStorage.getItem(MEMORY_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: PopoutMemory = {};
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			// Half an entry is no entry: without the source there is no set to page through,
			// and reopening one picture with no way back to its neighbours is a worse answer
			// than not reopening at all.
			const { path, sourceId } = (value ?? {}) as Partial<RememberedPopout>;
			if (typeof path === 'string' && path && typeof sourceId === 'string' && sourceId) {
				out[id] = { path, sourceId };
			}
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

export function rememberPopout(characterId: string, entry: RememberedPopout): void {
	writePopoutMemory(rememberIn(readPopoutMemory(), characterId, entry));
}

export function forgetPopout(characterId: string): void {
	writePopoutMemory(forgetIn(readPopoutMemory(), characterId));
}
