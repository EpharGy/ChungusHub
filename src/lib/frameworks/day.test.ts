/**
 * Day resolution tests. Run with `bun test`.
 *
 * The ladder is the contract: the story decides when it says anything, the stored day is the
 * floor, and the answer is a pure function of the path so a branch is correct for free.
 */

import { describe, expect, test } from 'bun:test';

import { formatDate, parseDate, resolveDay, serialOf } from './day';

const MANUAL = 7;

/** Shorthand: resolve over a path, with the stored day fixed. */
function day(...messages: string[]) {
	return resolveDay(messages, MANUAL);
}

describe('the manual floor', () => {
	test('an empty chat is the stored day', () => {
		expect(day()).toEqual({ day: MANUAL, source: 'manual' });
	});

	test('a chat that states nothing is the stored day', () => {
		expect(day('she crossed the yard', 'he said nothing')).toEqual({ day: MANUAL, source: 'manual' });
	});
});

describe('<Day N>', () => {
	test('is read from the newest turn that states one', () => {
		expect(day('<Day 3> they set out', 'they walked', 'they camped')).toMatchObject({
			day: 3,
			source: 'day-marker',
			depth: 2
		});
	});

	test('a later statement wins over an earlier one', () => {
		expect(day('<Day 3>', 'nothing', '<Day 9>')).toMatchObject({ day: 9, depth: 0 });
	});

	test('two in one turn: the last one, because a turn that spans days states the later second', () => {
		expect(day('<Day 3> ... and then <Day 4> dawned')).toMatchObject({ day: 4 });
	});

	test('tolerates spacing and case', () => {
		for (const text of ['<Day 12>', '<day 12>', '<DAY  12>', '< Day 12 >']) {
			expect(day(text).day).toBe(12);
		}
	});

	test('may be negative, because a story may run before its own day one', () => {
		expect(day('<Day -3>').day).toBe(-3);
	});

	test('UNBRACKETED prose is not a marker, which is the whole point of the brackets', () => {
		// "it had been day 47 of the siege" is narration. A tracker that read it would jump to
		// whatever number a character last reminisced about.
		expect(day('it had been day 47 of the siege').source).toBe('manual');
		expect(day('Day 47 dawned cold').source).toBe('manual');
	});
});

describe('<Time: ...>', () => {
	const T = (d: string) => `<Time: 11:53 AM, ${d}>`;
	const S = (y: number, m: number, d: number) => serialOf(y, m - 1, d);

	test('a date resolves to a serial against a FIXED epoch', () => {
		// Not counted from the first dated turn on the path. That read better and was quietly
		// wrong: the array is only ever the history that is loaded and in budget, so anything
		// derived from its beginning walks forward as a chat grows and every day shifts under
		// it. A fixed origin cannot drift, and the large number costs nothing because a cycle
		// needs `day mod length` and a date-written anchor subtracts the epoch straight out.
		expect(day(T('Sunday September 6, 2026'))).toMatchObject({
			day: S(2026, 9, 6),
			source: 'time-marker'
		});
	});

	test('what matters is the DIFFERENCE between two dates', () => {
		const a = day(T('September 6, 2026')).day;
		const b = day(T('September 9, 2026')).day;
		expect(b - a).toBe(3);
	});

	test('counts across a month and a year boundary', () => {
		expect(day(T('January 2, 2027')).day - day(T('December 30, 2026')).day).toBe(3);
	});

	test('a leap day is a real day', () => {
		expect(day(T('March 1, 2028')).day - day(T('February 27, 2028')).day).toBe(3);
	});

	test('history falling out of the path cannot move the answer', () => {
		// The property the fixed epoch exists for. Trim the front of the path and the newest
		// marker still resolves to the same number.
		const full = [T('September 1, 2026'), 'talk', T('September 9, 2026')];
		expect(resolveDay(full, MANUAL).day).toBe(resolveDay(full.slice(2), MANUAL).day);
	});

	test('abbreviated months work, and the weekday is ignored', () => {
		expect(day(T('Sun Sep 6, 2026')).day).toBe(S(2026, 9, 6));
		expect(day(T('Sep. 6, 2026')).day).toBe(S(2026, 9, 6));
		// A weekday that contradicts the date is the model's error, not ours to honour.
		expect(day(T('Monday September 6, 2026')).day).toBe(S(2026, 9, 6));
	});

	test('the clock time inside says nothing about which day it is', () => {
		expect(day('<Time: 11:53 PM, September 6, 2026>').day).toBe(day('<Time: 12:04 AM, September 6, 2026>').day);
	});

	test('a marker with no date it understands is ignored rather than guessed at', () => {
		expect(day('<Time: some time later>').source).toBe('manual');
	});
});

describe('parseDate, shared with a marker field', () => {
	test('reads the ISO form a marker anchor is written in', () => {
		expect(parseDate('2026-09-06')).toBe(serialOf(2026, 8, 6));
		expect(parseDate('  2026-9-6  ')).toBe(serialOf(2026, 8, 6));
	});

	test('reads the prose form a time marker carries', () => {
		expect(parseDate('September 6, 2026')).toBe(serialOf(2026, 8, 6));
	});

	test('both forms agree, which is what lets an anchor cancel the epoch out', () => {
		expect(parseDate('2026-09-06')).toBe(parseDate('Sunday September 6, 2026'));
	});

	test('anything else is null rather than a guess', () => {
		for (const text of ['', '12', 'tomorrow', '2026-13-01', '2026-09-32', '06/09/2026']) {
			expect(parseDate(text)).toBeNull();
		}
	});
});

describe('the ladder', () => {
	test('the newest turn carrying EITHER marker decides', () => {
		const out = day('<Day 3>', '<Time: 9:00 AM, September 6, 2026>');
		expect(out.source).toBe('time-marker');
		expect(out.depth).toBe(0);
	});

	test('and the other way round', () => {
		const out = day('<Time: 9:00 AM, September 6, 2026>', '<Day 30>');
		expect(out).toMatchObject({ day: 30, source: 'day-marker', depth: 0 });
	});

	test('within ONE turn, <Day N> wins: it states the unit outright', () => {
		const out = day('<Time: 9:00 AM, September 6, 2026> <Day 30>');
		expect(out).toMatchObject({ day: 30, source: 'day-marker' });
	});

	test('an intervening day marker does not disturb a later time marker', () => {
		const withDay = day('<Time: 9:00 AM, September 6, 2026>', '<Day 30>', '<Time: 9:00 AM, September 8, 2026>');
		const without = day('<Time: 9:00 AM, September 8, 2026>');
		expect(withDay.day).toBe(without.day);
	});

	test('markers below the deciding turn are not consulted', () => {
		expect(day('<Day 100>', '<Day 5>').day).toBe(5);
	});
});

describe('purity', () => {
	test('the same path twice gives the same answer, which the meter and the send rely on', () => {
		const path = ['<Time: 9:00 AM, September 6, 2026>', 'talk', '<Day 12>'];
		expect(resolveDay(path, 1)).toEqual(resolveDay(path, 1));
	});

	test('a branch is correct because a path IS a branch', () => {
		// Swiping away the newest turn leaves the path it belonged to, and the day follows.
		const full = ['<Day 3>', '<Day 9>'];
		expect(resolveDay(full, MANUAL).day).toBe(9);
		expect(resolveDay(full.slice(0, 1), MANUAL).day).toBe(3);
	});

	test('nothing here reads a clock', () => {
		// A real-time source would put the meter and the send either side of midnight. The
		// story's own clock, written into the transcript, is stable instead.
		const path = ['<Time: 11:59 PM, September 6, 2026>'];
		expect(resolveDay(path, 1).day).toBe(serialOf(2026, 8, 6));
	});
});

describe('reading a serial back', () => {
	test('the date a turn stated is the date shown', () => {
		expect(formatDate(serialOf(2026, 8, 7))).toBe('2026-09-07');
	});

	test('month and day are padded, so the form is always the same width', () => {
		expect(formatDate(serialOf(2026, 0, 1))).toBe('2026-01-01');
	});

	test('it round trips against the parser for a long run of consecutive days', () => {
		// The property that matters: these two are a pair, and a panel naming a day the
		// tracker is not counting would be worse than showing the raw serial.
		const start = serialOf(1998, 10, 27);
		for (let serial = start; serial < start + 4000; serial++) {
			expect(parseDate(formatDate(serial))).toBe(serial);
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
			expect(parseDate(formatDate(serial))).toBe(serial);
		}
	});

	test('a historical setting reads as its own year, not as 19xx', () => {
		// Date.UTC would put AD 47 into 1947. serialOf uses setUTCFullYear for this reason,
		// and the reader is the one who would have seen the wrong number.
		expect(formatDate(serialOf(47, 6, 4))).toBe('0047-07-04');
	});
});
