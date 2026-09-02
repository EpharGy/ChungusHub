/**
 * Which picture the pop-out was left showing, per character.
 *
 * The window is one picture belonging to one character's gallery, so what it is showing is
 * a property of that character rather than of the app: leaving a chat and coming back to it
 * should find the same picture, and switching to somebody else's story should not.
 *
 * Per-device, in localStorage, alongside the window's placement rather than on the settings
 * spine. The two records are halves of one answer (a window is a picture AND a rectangle),
 * and a rectangle is meaningless on another machine's screen, so sending half of it across
 * devices would make the pair disagree for no gain.
 *
 * Only the PATH is kept, never the set it was drawn from. The set is re-read from the
 * character's live gallery on the way back in, which is what makes an image deleted in the
 * meantime a miss to report rather than a stale name to render.
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

/** Character id → the image path its pop-out was left on. */
export type PopoutMemory = Record<string, string>;

/**
 * `map` with `characterId` recorded as most recent, capped at `limit`.
 *
 * Re-inserted rather than assigned in place: assigning to an existing key keeps its original
 * position, so a character you return to daily would still age out behind ones you have not
 * opened in weeks.
 */
export function rememberIn(map: PopoutMemory, characterId: string, path: string, limit = MEMORY_LIMIT): PopoutMemory {
	const next: PopoutMemory = { ...map };
	delete next[characterId];
	next[characterId] = path;
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

/** Every string-valued entry of the stored record, or an empty one when it is unreadable. */
export function readPopoutMemory(): PopoutMemory {
	try {
		const raw = localStorage.getItem(MEMORY_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: PopoutMemory = {};
		for (const [id, path] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof path === 'string' && path) out[id] = path;
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

export function rememberPopout(characterId: string, path: string): void {
	writePopoutMemory(rememberIn(readPopoutMemory(), characterId, path));
}

export function forgetPopout(characterId: string): void {
	writePopoutMemory(forgetIn(readPopoutMemory(), characterId));
}
