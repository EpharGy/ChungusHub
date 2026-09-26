/**
 * Where the story day comes from.
 *
 * The day belongs to the base rather than to any framework: story time is infrastructure, and
 * an age that advances, a season turning and a debt coming due all want the same integer from
 * the same place.
 *
 * **There is no marker parsing here, and there used to be a great deal of it.** An earlier
 * version scanned the chat for `<Time: ...>` markers the model had written and took the latest
 * date it found. Everything about that was in service of one case: a turn narrating a jump
 * ahead of today, which a clock cannot know about. The case does not exist, because the
 * framework that asks for those markers also tells the model that real time overrides the
 * story's own sense of when it is. Reading back a number we handed out a moment earlier is a
 * long way round to the value we already had.
 *
 * What that bought, beyond the deletion:
 *
 *   - **The marker no longer has to be parseable.** It is written for the reader, not for us,
 *     so nothing needs policing: not the format, not the month spelling, not whether it is the
 *     first line. A chunk of the instruction text existed only to satisfy a regex.
 *   - **A date the model invents cannot poison a chat.** Under the old rule a hallucinated
 *     year 2087 won permanently, since nothing can be later than a date that has not happened.
 *   - **Nothing depends on the chat path**, so a swipe, a branch and a trimmed history are all
 *     correct without having to be argued about.
 *
 * Pure: it is handed the mode, the stored day and today, and answers from them. Assembly runs
 * at least twice and the two runs must agree, so nothing here reads a clock; `today` arrives
 * as a number the caller measured. {@link todaySerial} is where that measurement is written
 * down, and it takes the `Date` rather than making one for the same reason.
 *
 * See architecture/frameworks.md.
 */

/**
 * How a chat decides what day it is. Per chat, because it is a fact about ONE story: some
 * stories run on the reader's own calendar and some count their own days.
 *
 * The two are exclusive and there is no ladder between them. They answer in different UNITS:
 * `marker` yields a serial date in the hundreds of thousands and `manual` yields whatever
 * small number the reader typed, so anything that fell back from one to the other would shift
 * every cycle reading `day mod length` to an unrelated point without a word.
 */
export type DayMode = 'manual' | 'marker';

/**
 * Which source answered, kept so a reader can be shown why the day is what it is.
 *
 * It also says what KIND of number came back, which a framework has to know to make sense of
 * its own fields: `clock` is a serial date and `manual` is a story day the author chose. An
 * anchor written against one is meaningless against the other.
 */
export type DaySource = 'clock' | 'manual';

export interface ResolvedDay {
	day: number;
	source: DaySource;
}

/** Everything {@link resolveDay} needs, handed in rather than reached for. */
export interface DayInput {
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
 * A date as a day count from a fixed origin, so two of them can be subtracted.
 *
 * The epoch is FIXED, and that is the whole point. Nothing derived from a chat's own history
 * can be, because the path is only ever the history that happens to be loaded and in budget,
 * so anything anchored to its beginning walks forward as a chat grows and every day number
 * shifts under it. A fixed origin cannot drift, and the large numbers it produces cost
 * nothing, because a cycle needs `day mod length`.
 *
 * UTC throughout, and that is not incidental: a local-time conversion would shift by a day
 * either side of a DST boundary, which would make the same chat resolve to different days on
 * two machines and break the one property this module exists to have. {@link todaySerial} is
 * the deliberate exception, and says why.
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
 * panel and to nothing else.
 */
const EPOCH_OFFSET = Math.floor(new Date(0).setUTCFullYear(1, 0, 1) / 86_400_000);

/**
 * A serial back as `2026-09-07`, for a surface showing a reader which day they are on.
 *
 * A serial is the only readable form of a `clock` day. The number itself is a count from year
 * 1 and reads as noise (739865 for an ordinary 2026 date), which is fine for arithmetic and
 * useless to a person. A `manual` day is NOT passed through here: that is a story day the
 * author chose, and 47 means day 47, not the year 1 plus 47.
 */
export function formatDate(serial: number): string {
	const at = new Date((serial + EPOCH_OFFSET) * 86_400_000);
	const year = at.getUTCFullYear();
	// A four-digit pad, with the sign kept outside it: `String(-5).padStart(4, '0')` is
	// "00-5", which is not a year anyone has ever written.
	const yyyy = year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
	const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(at.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Today, as a serial, from a `Date` the caller made.
 *
 * It takes the `Date` rather than calling `new Date()` so that this module still reads no
 * clock: the impurity is one argument at the call sites instead of a hidden read inside a
 * function two meters and a send all run.
 *
 * **Local accessors, deliberately**, where everything else here is UTC. This has to agree with
 * the date the model is shown, which is the clock on the reader's own wall. Reading UTC here
 * would put the day the frameworks count and the date in the marker an hour apart either side
 * of midnight, for anyone not on UTC.
 */
export function todaySerial(at: Date): number {
	return serialOf(at.getFullYear(), at.getMonth(), at.getDate());
}

/**
 * Resolve the day for one chat.
 *
 * Small enough to look like it is missing something, and it is not: `manual` mode never reads
 * the clock and `marker` mode never reads the stored day, which is the whole of the contract.
 * Everything that used to be here was scanning the transcript for a number this already knew.
 */
export function resolveDay(input: DayInput): ResolvedDay {
	return input.mode === 'manual'
		? { day: input.manual, source: 'manual' }
		: { day: input.today, source: 'clock' };
}
