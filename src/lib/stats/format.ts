/**
 * How the stats screen says its numbers out loud.
 *
 * Kept apart from the components because these are the sentences the screen is judged on:
 * a figure that reads wrong is worse than one that is missing, and a sentence assembled
 * inline in three different templates drifts into three different claims.
 */

/** A whole number with the reader's own thousands separators. */
export function count(value: number): string {
	return value.toLocaleString();
}

/** `n` with a unit that agrees with it. English only, like every other string on screen. */
export function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count(value)} ${value === 1 ? singular : pluralForm}`;
}

/**
 * A long span, in the two largest units that carry it: hours and minutes for an evening,
 * days and hours for a library's worth of waiting. Deliberately not the message meta row's
 * `formatDuration`, which is tuned for one reply and would report a week in seconds.
 */
export function span(ms: number): string {
	if (ms < 1000) return 'under a second';
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return plural(seconds, 'second');

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return plural(minutes, 'minute');

	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return rest ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour');
	}

	const days = Math.floor(hours / 24);
	const rest = hours % 24;
	return rest ? `${plural(days, 'day')} ${plural(rest, 'hour')}` : plural(days, 'day');
}

/** An average from a total and the number of things it was measured over. Null when there
 *  is nothing to divide by, which is what keeps a "0.0s average" off an unmeasured library. */
export function average(total: number, over: number): number | null {
	return over > 0 ? total / over : null;
}

/** A share of a whole, as a rounded percentage. Null when the whole is nothing. */
export function share(part: number, whole: number): number | null {
	return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** An hour of the day as a clock reading, for naming a window ("21:00 to 02:00"). */
export function hourLabel(hour: number): string {
	return `${`${hour}`.padStart(2, '0')}:00`;
}

/** A point in time as a readable date. The month is spelled out on purpose: this screen
 *  prints dates years apart, and no locale can make a written month ambiguous. */
export function dateLabel(at: number): string {
	return new Date(at).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

/** A `YYYY-MM-DD` day key as a readable date in the reader's own locale. */
export function dayLabel(key: string): string {
	const [y, m, d] = key.split('-').map(Number);
	return dateLabel(new Date(y, m - 1, d).getTime());
}

/** A point in time as its month alone ("Mar 2024"), for naming when something began:
 *  a day would claim more precision than "since" needs. */
export function monthYearLabel(at: number): string {
	return new Date(at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** When the count was taken: the date, plus the time, since a reader may take two in a day. */
export function momentLabel(at: number): string {
	const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	return `${dateLabel(at)} at ${time}`;
}

/**
 * Books to measure a word count against, ascending, each roughly twice the one below it.
 *
 * The ladder is what makes the comparison work at every size: the screen takes the largest
 * book that fits at least once, so a reader with a weekend's writing and a reader with four
 * years of it both get a sentence about a book they have heard of rather than a fraction of
 * one they haven't. Word counts are the published approximations and differ by edition and
 * translation, which is why the copy that renders this says "about as long as".
 */
const BOOKS: { title: string; words: number }[] = [
	{ title: 'The Old Man and the Sea', words: 27_000 },
	{ title: 'The Great Gatsby', words: 47_000 },
	{ title: 'The Hobbit', words: 95_000 },
	{ title: 'Moby-Dick', words: 206_000 },
	{ title: 'The Lord of the Rings', words: 480_000 },
	{ title: 'War and Peace', words: 587_000 }
];

export interface BookComparison {
	title: string;
	/** How many times over, at least one. */
	times: number;
}

/** The largest book a word count covers, and how many times it covers it. Null below the
 *  smallest one, where the honest answer is that there is nothing to compare to yet. */
export function bookComparison(words: number): BookComparison | null {
	let chosen: { title: string; words: number } | null = null;
	for (const book of BOOKS) {
		if (words >= book.words) chosen = book;
	}
	return chosen ? { title: chosen.title, times: Math.floor(words / chosen.words) } : null;
}

/** "The Hobbit" / "The Hobbit, twice over" / "The Hobbit, 5 times over". */
export function comparisonLabel(comparison: BookComparison): string {
	if (comparison.times === 1) return comparison.title;
	if (comparison.times === 2) return `${comparison.title}, twice over`;
	return `${comparison.title}, ${count(comparison.times)} times over`;
}
