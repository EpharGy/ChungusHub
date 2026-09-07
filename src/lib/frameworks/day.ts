/**
 * Where the story day comes from.
 *
 * The day belongs to the base rather than to any framework: story time is infrastructure, and
 * an age that advances, a season turning and a debt coming due all want the same integer from
 * the same place.
 *
 * Three sources, resolved as a ladder. The chat is scanned backwards from the newest turn and
 * the FIRST turn carrying a marker decides; the stored manual day is the floor when no turn
 * carries one. That ordering is what makes the tracker follow the story rather than the other
 * way round, and it is why a reader who never touches `/day` still gets a correct day as soon
 * as the story states one.
 *
 * Pure: it is handed the path and answers from it. Assembly runs at least twice and the two
 * runs must agree, so nothing here may read a clock. **`clock` as a day source is deliberately
 * absent**, and this is why: a real-time source would put the meter and the send either side
 * of midnight. What replaces it is the `<Time: ...>` marker below, which is the story's own
 * clock written into the transcript and therefore stable.
 *
 * See architecture/frameworks.md.
 */

/**
 * Which source answered, kept so a reader can be shown why the day is what it is.
 *
 * It also says what KIND of number came back, which a framework has to know to make sense of
 * its own fields: `time-marker` yields a serial date (days since 0001-01-01) while the other
 * two yield a story day the author chose. A cycle only needs `day mod length`, so both work,
 * but an anchor written for one is meaningless against the other.
 */
export type DaySource = 'day-marker' | 'time-marker' | 'manual';

export interface ResolvedDay {
	day: number;
	source: DaySource;
	/**
	 * How far back the deciding turn was, 0 being the newest. Absent for `manual`, which
	 * came from the chat's stored state rather than from any turn.
	 */
	depth?: number;
}

/**
 * `<Day 47>`, anywhere in a turn.
 *
 * Bracketed on purpose. An unbracketed "day 47" appears in ordinary prose constantly ("it had
 * been day 47 of the siege"), and a tracker that reads those is a tracker that jumps to
 * whatever number a character last reminisced about. The brackets are the author saying this
 * one is a statement of fact rather than a line of narration.
 */
const DAY_MARKER = /<\s*day\s+(-?\d{1,7})\s*>/gi;

/**
 * `<Time: 11:53 AM, Sunday September 6, 2026>`, anywhere in a turn.
 *
 * Only the DATE is read; the clock time inside is for the story's benefit and says nothing
 * about which day it is. The weekday is ignored too: it is redundant against the date and
 * trusting it would mean disagreeing with a model that got it wrong.
 */
const TIME_MARKER = /<\s*time\s*:[^>]*>/gi;

/** `September 6, 2026` and its abbreviated forms, inside a time marker. */
const DATE_IN_MARKER =
	/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s*,?\s+(\d{4})\b/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date as a day count from 1900-01-01, so two of them can be subtracted.
 *
 * The epoch is FIXED, and that is the whole point. An earlier version counted from the first
 * dated turn on the path, which read better (day 1 was the day the story started) and was
 * quietly wrong: the path is only ever the history that happens to be loaded and in budget, so
 * the "first" turn walks forward as a chat grows and every day number shifts under it. A fixed
 * origin cannot drift, and the large numbers it produces cost nothing, because a cycle needs
 * `day mod length` and an anchor written as a DATE subtracts the epoch out again.
 *
 * UTC throughout, and that is not incidental: a local-time conversion would shift by a day
 * either side of a DST boundary, which would make the same transcript resolve to different
 * days on two machines and break the one property this module exists to have.
 */
export function serialOf(year: number, monthIndex: number, day: number): number {
	// setUTCFullYear rather than Date.UTC: that constructor reads years 0-99 as 1900+year, so
	// a story set in AD 47 would land in 1947 without a word.
	const at = new Date(0);
	at.setUTCFullYear(year, monthIndex, day);
	at.setUTCHours(0, 0, 0, 0);
	return Math.floor(at.getTime() / 86_400_000) - EPOCH_OFFSET;
}

/**
 * Day zero: 0001-01-01, expressed as a Unix day count so `serialOf` can subtract it.
 *
 * The VALUE is arbitrary and the choice of it is not: a cycle only needs `day mod length`, so
 * nothing downstream cares where counting starts. Year 1 rather than 1970 or 1900 only so that
 * historical settings produce positive numbers, which matters to a person reading a debug
 * panel and to nothing else. A setting with no Gregorian calendar at all cannot use a date
 * marker and uses `<Day N>` instead.
 */
const EPOCH_OFFSET = Math.floor(new Date(0).setUTCFullYear(1, 0, 1) / 86_400_000);

/** `2026-09-06`, the unambiguous form a marker's own date field is written in. */
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * A date written either way, as a serial. Null when the text is not a date this understands.
 *
 * Shared with the frameworks that accept a date in a marker field, so a date means the same
 * thing wherever it is written and neither side can drift from the other.
 */
export function parseDate(text: string): number | null {
	const iso = ISO_DATE.exec(text.trim());
	if (iso) {
		const month = Number(iso[2]);
		const day = Number(iso[3]);
		if (month < 1 || month > 12 || day < 1 || day > 31) return null;
		return serialOf(Number(iso[1]), month - 1, day);
	}
	const found = DATE_IN_MARKER.exec(text);
	if (!found) return null;
	const monthIndex = MONTHS.indexOf(found[1].toLowerCase().slice(0, 3));
	const day = Number(found[2]);
	if (monthIndex < 0 || day < 1 || day > 31) return null;
	return serialOf(Number(found[3]), monthIndex, day);
}

/**
 * A serial back as `2026-09-07`.
 *
 * The exact inverse of {@link parseDate}'s ISO branch, and it lives beside it for that reason:
 * a reader is shown the date a turn stated, so if these two ever disagreed the panel would be
 * naming a day the tracker is not counting. The round trip is asserted in the tests.
 *
 * A serial is the only readable form of a `time-marker` day. The number itself is a count from
 * year 1 and reads as noise (739865 for an ordinary 2026 date), which is fine for arithmetic
 * and useless to a person. A `<Day N>` or a hand-set day is NOT passed through here: those are
 * story days the author chose, and 47 means day 47, not the year 1 plus 47.
 */
export function formatDate(serial: number): string {
	const at = new Date((serial + EPOCH_OFFSET) * 86_400_000);
	const year = at.getUTCFullYear();
	// A four-digit pad, with the sign kept outside it: `String(-5).padStart(4, '0')` is
	// "00-5", which is not a year anyone has ever written.
	const yyyy =
		year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
	const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(at.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** Every date a turn states, in the order they appear. */
function datesIn(text: string): number[] {
	const out: number[] = [];
	for (const match of text.matchAll(new RegExp(TIME_MARKER.source, TIME_MARKER.flags))) {
		const serial = parseDate(match[0]);
		if (serial !== null) out.push(serial);
	}
	return out;
}

/** The last `<Day N>` a turn states, or null. The LAST because a turn that moves the story
 *  through two days states the later one second. */
function dayMarkerIn(text: string): number | null {
	let last: number | null = null;
	for (const match of text.matchAll(new RegExp(DAY_MARKER.source, DAY_MARKER.flags))) {
		last = Number(match[1]);
	}
	return last;
}

/**
 * Resolve the day for one chat.
 *
 * `messages` is the chat path, oldest to newest, exactly as the lorebook scan receives it.
 * `manual` is the chat's stored day, used when the story states nothing.
 *
 * **Only the NEWEST marker is read.** Nothing here depends on how far back the path reaches,
 * which is the property that matters: the array is whatever history is loaded and in budget,
 * so anything derived from its beginning walks forward as a chat grows. An earlier version
 * anchored `<Time: ...>` dates on the first dated turn, and every day number would have
 * shifted under a long story without a word.
 *
 * A `<Time: ...>` date therefore resolves to a serial date against a fixed epoch. The number is
 * large and that costs nothing: a cycle needs `day mod length`, and a framework whose anchor is
 * written as a date subtracts the same epoch straight back out.
 */
export function resolveDay(messages: readonly string[], manual: number): ResolvedDay {
	// Backwards from the newest: the first turn carrying either marker decides. Within one
	// turn `<Day N>` wins, because it states the tracker's own unit outright where a date has
	// to be converted to mean anything.
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = messages[i];
		const depth = messages.length - 1 - i;

		const stated = dayMarkerIn(text);
		if (stated !== null) return { day: stated, source: 'day-marker', depth };

		const dates = datesIn(text);
		if (dates.length > 0) {
			// The LAST date in the turn: a turn spanning midnight states the later one second.
			return { day: dates[dates.length - 1], source: 'time-marker', depth };
		}
	}

	return { day: manual, source: 'manual' };
}
