/**
 * Day resolution tests. Run with `bun test`.
 *
 * The mode is the whole contract: `manual` answers from the stored day and never reads the
 * clock, `marker` answers from the clock and never reads the stored day. There is nothing to
 * test about parsing, because there is no parsing: the marker the model writes is for the
 * reader, and this module already knows what time it is.
 */

import { describe, expect, test } from 'bun:test';

import { formatDate, resolveDay, serialOf, todaySerial } from './day';

const MANUAL = 7;

/** A fixed today, so the suite reads the same in October as in March. */
const TODAY = todaySerial(new Date(2026, 9, 10));

const S = (y: number, m: number, d: number) => serialOf(y, m - 1, d);

describe('the two modes', () => {
	test('manual answers with the stored day', () => {
		expect(resolveDay({ mode: 'manual', manual: MANUAL, today: TODAY })).toEqual({
			day: MANUAL,
			source: 'manual'
		});
	});

	test('manual never reads the clock, whatever today happens to be', () => {
		const early = resolveDay({ mode: 'manual', manual: MANUAL, today: 1 });
		const late = resolveDay({ mode: 'manual', manual: MANUAL, today: 999_999 });
		expect(early).toEqual(late);
	});

	test('marker answers with today', () => {
		expect(resolveDay({ mode: 'marker', manual: MANUAL, today: TODAY })).toEqual({
			day: TODAY,
			source: 'clock'
		});
	});

	test('marker never reads the stored day', () => {
		const low = resolveDay({ mode: 'marker', manual: 1, today: TODAY });
		const high = resolveDay({ mode: 'marker', manual: 900, today: TODAY });
		expect(low).toEqual(high);
		expect(low.day).not.toBe(900);
	});

	test('the two answer in different UNITS, which is why nothing falls back between them', () => {
		// A serial date is in the hundreds of thousands and a story day is whatever the reader
		// typed. Anything that degraded from one to the other would shift every cycle reading
		// `day mod length` to an unrelated point without a word.
		const byClock = resolveDay({ mode: 'marker', manual: MANUAL, today: TODAY }).day;
		const byHand = resolveDay({ mode: 'manual', manual: MANUAL, today: TODAY }).day;
		expect(byClock).toBeGreaterThan(700_000);
		expect(byHand).toBe(MANUAL);
	});
});

describe('purity', () => {
	test('the same input twice gives the same answer, which the meter and the send rely on', () => {
		const input = { mode: 'marker' as const, manual: 1, today: TODAY };
		expect(resolveDay(input)).toEqual(resolveDay(input));
	});

	test('nothing here reads a clock: today arrives as an argument', () => {
		// The impurity is one argument at the call sites rather than a hidden read inside a
		// function two meters and a send all run. Pin it and the answer is fixed forever.
		expect(resolveDay({ mode: 'marker', manual: 1, today: 100 }).day).toBe(100);
		expect(resolveDay({ mode: 'marker', manual: 1, today: 500 }).day).toBe(500);
	});
});

describe('todaySerial', () => {
	test('reads the LOCAL date, to agree with the date the model is shown', () => {
		// The marker goes through toLocaleDateString, which is the reader's own wall clock.
		// Reading UTC here would disagree with it by a day for most of the world's evening.
		expect(todaySerial(new Date(2026, 9, 10, 23, 30))).toBe(S(2026, 10, 10));
		expect(todaySerial(new Date(2026, 9, 10, 0, 30))).toBe(S(2026, 10, 10));
	});

	test('the time of day makes no difference within one date', () => {
		const open = todaySerial(new Date(2026, 9, 10, 0, 0));
		const close = todaySerial(new Date(2026, 9, 10, 23, 59));
		expect(open).toBe(close);
	});

	test('consecutive days are consecutive serials', () => {
		const first = todaySerial(new Date(2026, 9, 10));
		const second = todaySerial(new Date(2026, 9, 11));
		expect(second - first).toBe(1);
	});
});

describe('the serial arithmetic frameworks count against', () => {
	test('what matters is the DIFFERENCE between two dates', () => {
		expect(S(2026, 11, 9) - S(2026, 11, 6)).toBe(3);
	});

	test('counts across a month and a year boundary', () => {
		expect(S(2027, 1, 2) - S(2026, 12, 30)).toBe(3);
	});

	test('a leap day is a real day', () => {
		expect(S(2028, 3, 1) - S(2028, 2, 27)).toBe(3);
	});

	test('the origin is FIXED, so nothing drifts as a chat grows', () => {
		// An earlier version counted from the first dated turn on the path, which read better
		// and was quietly wrong: the path is only ever the history that is loaded and in
		// budget, so its beginning walks forward and every day number shifts under it.
		expect(S(2026, 10, 10)).toBe(todaySerial(new Date(2026, 9, 10)));
	});
});

describe('reading a serial back', () => {
	test('a clock day is shown as the date it is', () => {
		expect(formatDate(serialOf(2026, 8, 7))).toBe('2026-09-07');
	});

	test('month and day are padded, so the form is always the same width', () => {
		expect(formatDate(serialOf(2026, 0, 1))).toBe('2026-01-01');
	});

	test('it round trips against serialOf for a long run of consecutive days', () => {
		const start = serialOf(1998, 10, 27);
		for (let serial = start; serial < start + 4000; serial++) {
			const shown = formatDate(serial);
			const [y, m, d] = shown.split('-').map(Number);
			expect(serialOf(y, m - 1, d)).toBe(serial);
		}
	});

	test('it round trips across a leap day, where an off-by-one would hide', () => {
		for (const [y, m, d] of [
			[2024, 1, 28],
			[2024, 1, 29],
			[2024, 2, 1],
			[1900, 1, 28],
			[2000, 1, 29]
		]) {
			const serial = serialOf(y, m, d);
			const [yy, mm, dd] = formatDate(serial).split('-').map(Number);
			expect(serialOf(yy, mm - 1, dd)).toBe(serial);
		}
	});

	test('a historical setting reads as its own year, not as 19xx', () => {
		// Date.UTC would put AD 47 into 1947. serialOf uses setUTCFullYear for this reason,
		// and the reader is the one who would have seen the wrong number.
		expect(formatDate(serialOf(47, 6, 4))).toBe('0047-07-04');
	});
});
