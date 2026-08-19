/** A timestamp as ISO 8601 `YYYY-MM-DD`, the app's ONE numeric date shape. Every
 *  surface that prints digits rather than words goes through here.
 *
 *  Deliberately locale-independent instead of following the reader's own order, which
 *  is the opposite of the rule the clock obeys: `08/04/2026` is August 4th or April 8th
 *  depending on where the reader sits, and nothing on screen says which one it is.
 *  Year-first is the only order that cannot be misread, and it sorts as text.
 *  Dates spelled out in words carry no such ambiguity, so those stay in the reader's
 *  language (see `time-format.svelte.ts`). */
export function formatDate(timestamp: number): string {
	const date = new Date(timestamp);
	const month = (date.getMonth() + 1).toString().padStart(2, '0');
	const day = date.getDate().toString().padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of the day a timestamp falls in. */
function startOfDay(timestamp: number): number {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

/** Calendar days between two timestamps, counted between local midnights so
 *  "yesterday" means yesterday and not "24 hours ago". Rounded, not floored: two
 *  local midnights are 23 or 25 hours apart across a DST switch, and a floor would
 *  quietly shift every bucket on those two days a year. */
function calendarDaysAgo(timestamp: number, now: number): number {
	return Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);
}

export type DayBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older';

/** Which section of a date-grouped list a timestamp belongs to. Anything in the
 *  future (clock skew between devices) reads as today rather than as a negative age. */
export function dayBucket(timestamp: number, now: number = Date.now()): DayBucket {
	const days = calendarDaysAgo(timestamp, now);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return 'week';
	if (days < 30) return 'month';
	return 'older';
}

/** Short "when was this" for list rows: minutes and hours while that's the useful
 *  answer, then days, then the plain date.
 *
 *  Each band is chosen from the elapsed time itself and floored, never rounded: a
 *  rounded 23h35m reads as 24 hours, skips the hours band, and then lands on a
 *  calendar-day count of zero because no midnight was crossed, printing "0d ago"
 *  under a "Today" heading for half an hour of every day. */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
	const diff = now - timestamp;
	if (diff < 45_000) return 'Just now';
	if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

	// Past 24 hours at least one midnight has been crossed, so this is never 0.
	const days = calendarDaysAgo(timestamp, now);
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days}d ago`;
	return formatDate(timestamp);
}
