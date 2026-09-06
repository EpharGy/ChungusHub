/**
 * The marker grammar: `@<framework>[<key>, name=value, ...]`
 *
 *     @season[harbor, len=90, start=14]
 *
 * A marker is BOTH the configuration and the placement. It says which framework, which
 * subject, and with what numbers; and it marks the spot in the entry where that
 * framework's computed line goes. Parsing and placement are therefore one act, which is
 * what keeps them from drifting apart.
 *
 * The first field is always the subject key and is required. Everything after it is
 * `name=value` in any order. That shape is deliberate: a field added later must never
 * change what an existing marker means, which all-positional cannot promise.
 *
 * **This is not a macro and must never become one.** It does not match MACRO_REGEX, so
 * `substitute` leaves it whole and `extractMacroNames` never reports it: the two systems
 * do not interact at all. Keeping the sigil un-brace-shaped is what makes that obvious to
 * a reader, and it means a marker in a build without its framework reads as odd text
 * rather than as a broken macro.
 *
 * Pure: no stores, no db, no Svelte. See architecture/frameworks.md.
 */

/**
 * One marker found in a piece of text.
 *
 * `raw` and `index` are what let the dispatcher rebuild the text in a single pass, so
 * several markers in one entry cannot shift each other's positions.
 */
export interface ParsedMarker {
	/** The matched text exactly as written, including the sigil and brackets. */
	raw: string;
	/** Offset of `raw` in the text it was found in. */
	index: number;
	/** The framework id, lowercased. */
	frameworkId: string;
	/** The subject key, folded through {@link normalizeSubjectKey}. Null when malformed. */
	key: string | null;
	/** Named fields, verbatim (trimmed). Empty when the marker is malformed. */
	fields: Record<string, string>;
	/** Why this marker cannot be used, or null when it parsed cleanly. */
	error: string | null;
}

/**
 * The marker shape.
 *
 * The bracket body deliberately excludes `]` and newlines: a marker is a one-line thing,
 * and without the newline exclusion an unclosed bracket would swallow the rest of the
 * entry and take a paragraph of prose out of the prompt with it.
 */
const MARKER_RE = /@([a-z][a-z0-9-]*)\[([^\]\n]*)\]/gi;

/**
 * What a subject key may be.
 *
 * **A subject key is a NAME, and names have spaces in them.** An earlier rule here was a
 * slug (`[a-z0-9_-]`), which quietly rejected `Ada Lovelace` and, because a malformed marker
 * is stripped, took her line out of the prompt with nothing on screen to say why. Anyone
 * writing a marker types the character's name, so that is what this accepts.
 *
 * Letters and digits in any script, because a cast is not always Latin-alphabet, plus the
 * punctuation that turns up inside real names. Deliberately NOT a comma (it separates
 * fields), an equals sign (it separates a field's name from its value) or a bracket (it ends
 * the marker).
 */
const SUBJECT_KEY_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’._-]*$/u;

/** Field names stay strict: they are a vocabulary this app defines (`len`, `start`), not
 *  something anyone names, and a space in one is a typo rather than a person. */
const FIELD_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * One spelling of a subject key, so the same person written two ways is the same subject.
 *
 * Lowercased, and internal runs of whitespace collapsed: `Ada  Lovelace` and `ada lovelace`
 * both key the per-chat suppression and state maps identically. Those maps are keyed on this
 * output, so anything that writes one must normalize the same way.
 */
export function normalizeSubjectKey(raw: string): string {
	return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Does this text contain anything that looks like a marker? Cheap pre-check for callers
 *  that would otherwise parse every lorebook entry on every assembly. Uses its own
 *  non-global copy: a global regex carries `lastIndex` and answers differently on
 *  alternate calls, which is the bug `ARG_MACRO_TEST` exists to avoid in macros.ts. */
const MARKER_TEST = new RegExp(MARKER_RE.source, 'i');

export function hasMarker(text: string): boolean {
	return text ? MARKER_TEST.test(text) : false;
}

/**
 * Parse one marker's bracket body into a key and named fields.
 *
 * Every failure is reported rather than guessed at. A marker that cannot be understood is
 * still stripped from the prompt (config text must never reach the model), so the reason
 * is the only thing left that can tell the author their typo apart from a character who
 * is simply not tracked.
 */
function parseBody(body: string): { key: string | null; fields: Record<string, string>; error: string | null } {
	const fail = (error: string) => ({ key: null, fields: {}, error });
	const parts = body.split(',').map((part) => part.trim());
	const rawKey = parts.shift() ?? '';
	if (!rawKey) return fail('no subject key');
	if (!SUBJECT_KEY_RE.test(rawKey)) return fail(`invalid subject key "${rawKey}"`);

	const fields: Record<string, string> = {};
	for (const part of parts) {
		// A trailing comma is a typo, not a field. Reported rather than skipped, because
		// silently tolerating it teaches a spelling the parser only half accepts.
		if (!part) return fail('empty field');
		const eq = part.indexOf('=');
		if (eq < 1) return fail(`field "${part}" is not name=value`);
		const name = part.slice(0, eq).trim().toLowerCase();
		const value = part.slice(eq + 1).trim();
		if (!FIELD_NAME_RE.test(name)) return fail(`invalid field name "${name}"`);
		// Last-wins on a duplicate is a silent trap: the author sees both and the parser
		// obeys one. Rejecting says which line to fix.
		if (name in fields) return fail(`duplicate field "${name}"`);
		fields[name] = value;
	}
	return { key: normalizeSubjectKey(rawKey), fields, error: null };
}

/**
 * Every marker in a piece of text, in the order they appear.
 *
 * Malformed markers are returned too, carrying their `error`: the dispatcher has to strip
 * those as well, so it needs to know where they are.
 */
export function findMarkers(text: string): ParsedMarker[] {
	if (!text) return [];
	const found: ParsedMarker[] = [];
	// A fresh regex per call rather than resetting lastIndex on a shared global one, so
	// this is safe to call reentrantly and from tests in any order.
	const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
	for (const match of text.matchAll(re)) {
		const parsed = parseBody(match[2]);
		found.push({
			raw: match[0],
			index: match.index,
			frameworkId: match[1].toLowerCase(),
			...parsed
		});
	}
	return found;
}
