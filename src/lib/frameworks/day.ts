/**
 * Where the story day comes from.
 *
 * The day belongs to the base rather than to any framework: story time is infrastructure, and
 * an age that advances, a season turning and a debt coming due all want the same integer from
 * the same place. A framework may OWN the instructions that put a marker in the transcript
 * (see the date framework), but the number those markers resolve to is read here, once, so
 * that two frameworks can never disagree about what day it is.
 *
 * **The mode decides which question is being asked, and the two do not overlap.** `manual` is
 * a day the reader sets and nothing else may move; `marker` is a day the story states and the
 * stored number is never consulted. An earlier version had no mode and resolved a ladder
 * across both, which was wrong in a way that took a while to see: a chat resumed after a real
 * week found the newest turn carrying a marker and answered with the date that turn was
 * written, so a tracker downstream kept computing against a day the story had already left.
 * Nothing in a ladder can fix that, because the stale marker is a perfectly good answer to
 * "what is the newest thing the transcript says".
 *
 * In `marker` mode the answer is the LATEST date in play, not the newest turn's: the clock is
 * always a candidate, and a transcript date beats it only by being further ahead, which is
 * what makes a narrated jump forward stick without a real week of silence dragging the day
 * backwards. See {@link resolveDay}.
 *
 * Pure: it is handed the path, the mode and today, and answers from them. Assembly runs at
 * least twice and the two runs must agree, so nothing here reads a clock itself; `today`
 * arrives as a number the caller measured. {@link todaySerial} is where that measurement is
 * written down, and it takes the `Date` rather than making one for the same reason.
 *
 * See architecture/frameworks.md.
 */

/**
 * How a chat decides what day it is. Per chat, because it is a fact about ONE story.
 *
 * The two are exclusive on purpose and there is no ladder between them. A story running on
 * the reader's own calendar and a story counting its own days want opposite things from the
 * same transcript, and a mode that fell back from one to the other would answer with the
 * wrong unit rather than with nothing: `marker` yields a serial date in the hundreds of
 * thousands and `manual` yields whatever small number the reader typed, so a fallback across
 * them shifts every cycle that reads `day mod length` to an unrelated point without a word.
 */
export type DayMode = 'manual' | 'marker';

/**
 * Which source answered, kept so a reader can be shown why the day is what it is.
 *
 * `clock` and `time-marker` both yield a serial date (days since 0001-01-01) and are freely
 * comparable; `manual` yields the story day the reader chose. A framework whose anchor is
 * written against one is meaningless against the other, which is what the mode exists to
 * stop, and the two serial sources differ only in WHICH date won: `clock` is today, and
 * `time-marker` means the story has stated a date further ahead than today.
 */
export type DaySource = 'clock' | 'time-marker' | 'manual';

export interface ResolvedDay {
	day: number;
	source: DaySource;
	/**
	 * How far back the deciding turn was, 0 being the newest. Present for `time-marker`
	 * only: `clock` and `manual` came from outside the transcript, so no turn can be named.
	 */
	depth?: number;
}

/** Everything {@link resolveDay} needs, handed in rather than reached for. */
export interface DayInput {
	/** The chat path, oldest to newest, exactly as the lorebook scan receives it. */
	messages: readonly string[];
	mode: DayMode;
	/** The chat's stored day. Read in `manual` mode and ignored in `marker`. */
	manual: number;
	/**
	 * Today as a serial, from {@link todaySerial}. Read in `marker` mode and ignored in
	 * `manual`, so a caller with no clock to offer may pass anything there.
	 */
	today: number;
}

/**
 * `<Time: 11:53 AM, Sunday September 6, 2026>`, anywhere in a turn, in either shape.
 *
 * Only the DATE is read. The clock time inside says nothing about which day it is, and the
 * weekday is ignored too: it is redundant against the date, and trusting it would mean
 * disagreeing with a model that got it wrong. It is written anyway, because a weekday beside
 * a long-form date gives the model something to check itself against, and models are
 * noticeably worse at naming the weekday for a bare ISO date.
 *
 * **Both shapes are accepted, permanently, whichever one is currently being asked for.**
 * `<Time: ...>` renders as visible text in the transcript; `<!-- Time: ... -->` is an HTML
 * comment, which the markdown pipeline emits as a comment node and no browser draws. Which
 * one the model is TOLD to write is the date framework's setting, and a reader who changes
 * it leaves a chat whose older turns are all in the other shape. A parser that read only the
 * current shape would go blind to that history the moment the switch was flipped, so it
 * reads both and only the instruction ever changes.
 *
 * The comment form works out because `[^>]*` stops at the first `>`, which in `-->` is the
 * last character of the marker: the trailing `--` is swallowed as body text and the date
 * inside is found regardless.
 */
const TIME_MARKER = /<(?:!--)?\s*time\s*:[^>]*>/gi;

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

/** The latest date a turn states, or null. The LATEST rather than the last written, because
 *  a turn is prose and nothing orders the sentences in it. */
function latestDateIn(text: string): number | null {
	let best: number | null = null;
	for (const match of text.matchAll(new RegExp(TIME_MARKER.source, TIME_MARKER.flags))) {
		const serial = parseDate(match[0]);
		if (serial !== null && (best === null || serial > best)) best = serial;
	}
	return best;
}

/**
 * Today, as a serial, from a `Date` the caller made.
 *
 * It takes the `Date` rather than calling `new Date()` so that this module still reads no
 * clock: the impurity is one argument at three call sites instead of a hidden read inside a
 * function two meters and a send all run.
 *
 * **Local accessors, deliberately**, where everything else here is UTC. This has to agree
 * with what `{{date}}` renders into the marker the model is shown, and that goes through
 * `toLocaleDateString`, which is the reader's own wall clock. Reading UTC here would put the
 * day the framework counts and the date the model was told an hour apart either side of
 * midnight, for anyone not on UTC.
 */
export function todaySerial(at: Date): number {
	return serialOf(at.getFullYear(), at.getMonth(), at.getDate());
}

/**
 * Resolve the day for one chat.
 *
 * **`manual` mode never looks at the transcript, and `marker` mode never looks at the stored
 * day.** That is the whole of the mode, and it is what keeps the two units from ever being
 * mixed (see {@link DayMode}).
 *
 * In `marker` mode the answer is the LATEST date in play: today, or a transcript date further
 * ahead than today. Two things fall out of that, and both are the point rather than side
 * effects:
 *
 *   - **A resumed chat is current.** The newest turn carrying a marker may be a real week
 *     old, and under a newest-turn rule it would decide; here it simply loses to today.
 *   - **A narrated jump forward sticks.** A turn that says the story is now three weeks on
 *     states a date beyond today and keeps winning until the clock catches up to it.
 *
 * The cost is stated plainly because there is no guard against it: a date the model invents
 * far in the future wins permanently, and no later turn can pull the day back, because
 * nothing can be later than a date that has not happened. `manual` mode and an edit to the
 * offending turn are the two ways out. A cap on how far ahead a marker may reach was
 * considered and left out: every value for it is arbitrary, and a story legitimately set in
 * 2400 is not rarer than a model typo.
 *
 * Nothing here depends on how far back the path reaches. The array is whatever history is
 * loaded and in budget, so anything derived from its beginning walks forward as a chat grows;
 * a maximum over the whole path does not, and neither does a fixed epoch.
 */
export function resolveDay(input: DayInput): ResolvedDay {
	if (input.mode === 'manual') return { day: input.manual, source: 'manual' };

	// Newest first, so a date matched by two turns is reported at the shallowest depth: the
	// turn a reader would look at to see where the number came from.
	let best: number | null = null;
	let depth: number | undefined;
	for (let i = input.messages.length - 1; i >= 0; i--) {
		const stated = latestDateIn(input.messages[i]);
		if (stated !== null && (best === null || stated > best)) {
			best = stated;
			depth = input.messages.length - 1 - i;
		}
	}

	// Today wins ties. A transcript date EQUAL to today is the story keeping step with the
	// clock rather than having jumped, and `clock` is the honest way to say that.
	if (best === null || best <= input.today) return { day: input.today, source: 'clock' };
	return { day: best, source: 'time-marker', depth };
}
