/**
 * Everything the stats screen works out for itself, from the server's activity series.
 *
 * **Days belong to the reader, which is why this is client-side.** The server ships
 * fifteen-minute buckets in plain epoch time and takes no view on where a day starts; only
 * the browser knows the reader's zone and its daylight-saving history. Bucket server-side
 * instead and a reader one time zone over gets their late-night messages filed under the
 * wrong date, their streak broken at a midnight that never happened for them, and their
 * "busiest day" landing on the day after the one they remember.
 *
 * Pure functions, no runes, no stores: the screen calls them once when its data lands.
 */
import type { UserStats } from '$lib/types/stats';

/** One local calendar day that saw at least one message. */
export interface ActiveDay {
	/** `YYYY-MM-DD` in the reader's own zone. The identity of the day. */
	key: string;
	/** Local midnight, for placing the day on a calendar grid. */
	at: number;
	count: number;
}

export interface Streak {
	days: number;
	/** The run's first and last day keys, so the screen can name the span. Null when there
	 *  is no run at all. */
	from: string | null;
	to: string | null;
}

function dayKey(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of the day `at` falls in. */
export function startOfLocalDay(at: number): number {
	const d = new Date(at);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The day after `at`, built through the Date constructor rather than by adding 24 hours,
 *  so the one day a year that is 23 or 25 hours long still steps exactly one day. */
export function nextLocalDay(at: number): number {
	const d = new Date(at);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** The server's buckets folded into the reader's own calendar days, oldest first. Only days
 *  that saw something appear; a calendar grid fills its own gaps. */
export function toActiveDays(activity: UserStats['activity']): ActiveDay[] {
	const byDay = new Map<string, ActiveDay>();
	for (const [at, count] of activity) {
		const start = startOfLocalDay(at);
		const key = dayKey(new Date(start));
		const day = byDay.get(key);
		if (day) day.count += count;
		else byDay.set(key, { key, at: start, count });
	}
	return [...byDay.values()].sort((a, b) => a.at - b.at);
}

/** The longest run of consecutive active days. Ties keep the EARLIEST run: a record is the
 *  first time it was set, and a later run that only matched it did not beat it. */
export function longestStreak(days: ActiveDay[]): Streak {
	if (!days.length) return { days: 0, from: null, to: null };

	let best: Streak = { days: 1, from: days[0].key, to: days[0].key };
	let runLength = 1;
	let runStart = 0;
	for (let i = 1; i < days.length; i++) {
		if (days[i].at === nextLocalDay(days[i - 1].at)) {
			runLength += 1;
		} else {
			runLength = 1;
			runStart = i;
		}
		if (runLength > best.days) {
			best = { days: runLength, from: days[runStart].key, to: days[i].key };
		}
	}
	return best;
}

/**
 * The run still going as of `now`, or zero.
 *
 * Today counts as part of it but is not required to have started: a streak is not broken
 * until a whole day passes with nothing in it, so someone reading this at breakfast is not
 * told their run ended overnight.
 */
export function currentStreak(days: ActiveDay[], now: number): Streak {
	if (!days.length) return { days: 0, from: null, to: null };

	const today = startOfLocalDay(now);
	const last = days[days.length - 1].at;
	if (last !== today && nextLocalDay(last) !== today) return { days: 0, from: null, to: null };

	let i = days.length - 1;
	while (i > 0 && days[i].at === nextLocalDay(days[i - 1].at)) i--;
	return { days: days.length - i, from: days[i].key, to: days[days.length - 1].key };
}

/** Messages per hour of the reader's own day, 0 to 23. Always 24 entries, so a chart can
 *  draw the quiet hours as the empty bars they are. */
export function hourHistogram(activity: UserStats['activity']): number[] {
	const hours = new Array<number>(24).fill(0);
	for (const [at, count] of activity) hours[new Date(at).getHours()] += count;
	return hours;
}

/** The single busiest local day, or null on an empty library. Ties keep the earliest, for
 *  the same reason `longestStreak` does. */
export function busiestDay(days: ActiveDay[]): ActiveDay | null {
	let best: ActiveDay | null = null;
	for (const day of days) {
		if (!best || day.count > best.count) best = day;
	}
	return best;
}

/**
 * The stretch of hours the reader is most reliably found in, as a `[startHour, endHour]`
 * pair covering half of everything they have written, or null when there is nothing.
 *
 * A single peak hour is noise on a small library and says little on a large one ("you write
 * most at 22:00" is true of almost everyone). A window is the shape of a habit. It is found
 * by walking every wrap-around run of hours and keeping the shortest one that still holds
 * half the messages, so a reader who plays two separate sessions a day gets the wide window
 * that honestly describes them rather than one of the two peaks.
 */
export function primeHours(hours: number[]): [number, number] | null {
	const total = hours.reduce((a, b) => a + b, 0);
	if (!total) return null;

	const half = total / 2;
	let best: [number, number] | null = null;
	let bestWidth = Infinity;
	for (let start = 0; start < 24; start++) {
		let sum = 0;
		for (let width = 1; width <= 24; width++) {
			sum += hours[(start + width - 1) % 24];
			if (sum >= half) {
				if (width < bestWidth) {
					bestWidth = width;
					best = [start, (start + width - 1) % 24];
				}
				break;
			}
		}
	}
	return best;
}
