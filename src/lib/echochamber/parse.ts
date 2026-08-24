/**
 * The reaction parser: model output in, `Reaction[]` out.
 *
 * Styles ask the model for one reaction per line as `username: message`, and models are
 * only ever approximately obedient about it. They number the lines, bold the handle, wrap
 * the block in a tag nobody asked for, wander onto a second line mid-sentence, and open
 * with a paragraph of reasoning. Everything here is the accumulated repair for that, and
 * it is lenient on purpose: a feed is decoration, so a line the parser cannot read should
 * cost that line and never the batch.
 *
 * Pure: no DOM, no `$lib`, no Svelte. `echochamber.test.ts` covers it directly.
 */

import type { MessageOrder, Reaction } from './types';

/** Reasoning wrappers a model may emit before the feed. Stripped whole, tag and content. */
const THINKING_TAGS = /<(thinking|think|thought|reasoning|reason)>[\s\S]*?<\/\1>/gi;

/**
 * A wrapper the model invents around the block because the style's format section looks
 * like it is describing one. Only the tag goes; the lines inside are the feed.
 */
const WRAPPER_TAGS = /<\/?(discordchat|chat|feed|messages|reactions)>/gi;

/** A line of nothing but separator punctuation, which models use to divide batches. */
const SEPARATOR_LINE = /^[.…\-_*=~]+$/;

/**
 * `username: message`, tolerating the ways a model dresses it up.
 *
 * The leading group eats list numbering (`1.`, `-`, `*`). The name group is lazy, so on a
 * line with several colons the FIRST one splits it: `Dave: it's 5:30` keeps the time in
 * the message where it belongs, which a greedy match would not.
 */
const REACTION_LINE = /^(?:[\d.\-*]*\s*)?(.+?):\s*(.+)$/;

/**
 * Decoration models wrap a handle in, stripped so `**Dave**` and `Dave` are one person.
 *
 * **Only at the ends.** The extension stripped these characters everywhere in the name,
 * which quietly destroyed the usernames its own styles ask for: `dave_99` arrived as
 * `dave99` and `xX_ShadowReaper_Xx` as `xXShadowReaperXx`. An underscore inside a handle is
 * the handle; one wrapping it is markdown.
 */
const NAME_DECORATION_LEADING = /^[*_`"'\s]+/;
const NAME_DECORATION_TRAILING = /[*_`"'\s]+$/;

/** Longer than this is prose that happened to contain a colon, not a handle. */
const MAX_USERNAME_LENGTH = 40;

/** Shorter than this is punctuation left over from a repair, not a message. */
const MIN_TEXT_LENGTH = 2;

/**
 * Resolve a generated name against the story's real cast.
 *
 * Only used by `usesStoryCast` styles, where the crowd IS the cast and an invented name is
 * a hallucination rather than a feature. Models reliably get a first name right and then
 * invent a surname for it, so a first-name match is a real match; anything else is not,
 * and returning null tells the caller to discard that line entirely.
 */
export function snapToCast(name: string, castNames: string[]): string | null {
	if (castNames.length === 0) return name;
	const trimmed = name.trim();
	const lower = trimmed.toLowerCase();

	const exact = castNames.find((n) => n === trimmed);
	if (exact) return exact;

	const caseInsensitive = castNames.find((n) => n.toLowerCase() === lower);
	if (caseInsensitive) return caseInsensitive;

	const generatedFirst = lower.split(/\s+/)[0];
	const firstName = castNames.find((n) => n.toLowerCase().split(/\s+/)[0] === generatedFirst);
	if (firstName) return firstName;

	return null;
}

export interface ParseOptions {
	/** Hard cap on how many reactions survive. */
	limit: number;
	/**
	 * The real cast, for a `usesStoryCast` style. Empty means invented handles are welcome,
	 * which also turns on the last-resort salvage below.
	 */
	castNames?: string[];
	/** Display order. Applied AFTER the cap - see `parseReactions`. */
	order?: MessageOrder;
}

/**
 * Read a model's reply into reactions.
 *
 * **The cap is applied before the ordering, not after.** The extension ordered first and
 * then took the first N, so `newest-first` kept the LAST n reactions the model wrote and
 * `oldest-first` kept the first n - the display toggle silently changed WHICH reactions
 * existed, and half of every batch was discarded depending on a preference about layout.
 * Here the first `limit` the model produced always win, and order only decides how they
 * are shown.
 */
export function parseReactions(raw: string, options: ParseOptions): Reaction[] {
	const { limit, castNames = [], order = 'oldest-first' } = options;
	if (limit <= 0) return [];

	const cleaned = raw.replace(THINKING_TAGS, '').replace(WRAPPER_TAGS, '').trim();
	if (!cleaned) return [];

	const snapping = castNames.length > 0;
	const parsed: Reaction[] = [];
	let current: Reaction | null = null;

	for (const line of cleaned.split('\n')) {
		const trimmed = line.trim();

		// A blank line inside a reaction is a paragraph break in that reaction, not the end
		// of it: models write a two-paragraph rant as one 'message' and expect both halves.
		if (!trimmed) {
			if (current && !current.text.endsWith('\n\n')) current.text += '\n\n';
			continue;
		}

		if (SEPARATOR_LINE.test(trimmed)) continue;

		const match = trimmed.match(REACTION_LINE);
		if (match) {
			let username = match[1]
				.replace(NAME_DECORATION_LEADING, '')
				.replace(NAME_DECORATION_TRAILING, '');
			if (!username) continue;
			if (username.length > MAX_USERNAME_LENGTH) {
				username = username.slice(0, MAX_USERNAME_LENGTH);
			}

			if (snapping) {
				const snapped = snapToCast(username, castNames);
				// An unrecognised speaker in a cast style is a hallucination. Dropping the line
				// also drops its continuations: `current` stays on the last line we accepted,
				// so a rejected speaker's overflow would otherwise be glued onto a real one.
				if (!snapped) {
					current = null;
					continue;
				}
				username = snapped;
			}

			current = { username, text: match[2].trim() };
			parsed.push(current);
			continue;
		}

		// No colon: either the tail of the reaction above, or (when handles are invented)
		// a bare line worth salvaging under a generic name. A cast style never salvages  - 
		// a line with no speaker has no one in the cast to attribute it to.
		if (current) {
			// A continuation is joined with a space, except straight after a paragraph break,
			// where the newlines are the separator and a space would indent the new paragraph.
			current.text += current.text.endsWith('\n') ? trimmed : ' ' + trimmed;
		} else if (!snapping) {
			current = { username: 'User', text: trimmed };
			parsed.push(current);
		}
	}

	const kept: Reaction[] = [];
	for (const reaction of parsed) {
		const text = reaction.text.replace(/\n{3,}/g, '\n\n').trim();
		if (text.length < MIN_TEXT_LENGTH) continue;
		kept.push({ username: reaction.username, text });
		if (kept.length >= limit) break;
	}

	return order === 'newest-first' ? kept.reverse() : kept;
}
