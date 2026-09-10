/**
 * Day resolution tests. Run with `bun test`.
 *
 * The mode is the contract: `manual` answers from the stored day and never reads the
 * transcript, `marker` answers from the latest date in play and never reads the stored day.
 * Every marker-mode test pins `today`, so nothing here depends on when it runs.
 */

import { describe, expect, test } from 'bun:test';

import { formatDate, parseDate, resolveDay, serialOf, todaySerial } from './day';

const MANUAL = 7;

/** A fixed today, so the suite reads the same in October as in March. */
const TODAY = todaySerial(new Date(2026, 9, 10));

const S = (y: number, m: number, d: number) => serialOf(y, m - 1, d);

/** Shorthand: resolve over a path in marker mode, against the pinned today. */
function marker(...messages: string[]) {
	return resolveDay({ messages, mode: 'marker', manual: MANUAL, today: TODAY });
}

/** The same path in manual mode, to show the transcript makes no difference there. */
function manual(...messages: string[]) {
	return resolveDay({ messages, mode: 'manual', manual: MANUAL, today: TODAY });
}

const T = (d: string) => `<Time: 11:53 AM, ${d}>`;

describe('manual mode', () => {
	test('an empty chat is the stored day', () => {
		expect(manual()).toEqual({ day: MANUAL, source: 'manual' });
	});

	test('the transcript is not read at all, however loudly it states a date', () => {
		expect(manual(T('October 20, 2026'), T('October 30, 2026'))).toEqual({
			day: MANUAL,
			source: 'manual'
		});
	});

	test('and neither is the clock', () => {
		expect(manual().day).not.toBe(TODAY);
	});
});

describe('marker mode', () => {
	test('an empty chat is today, not the stored day', () => {
		expect(marker()).toEqual({ day: TODAY, source: 'clock' });
	});

	test('the stored day is never consulted, even when nothing states a date', () => {
		expect(marker('she crossed the yard').day).not.toBe(MANUAL);
	});

	test('A STALE MARKER LOSES TO TODAY, which is the whole reason the mode exists', () => {
		// The failure this was built for: a chat halts on the 1st, the reader comes back on
		// the 10th, and the newest turn carrying a marker is still the assistant's from nine
		// days ago. Under a newest-turn rule that turn decides and every tracker downstream
		// computes against a day the story has already left.
		expect(marker(T('October 1, 2026'), 'picking this back up')).toEqual({
			day: TODAY,
			source: 'clock'
		});
	});

	test('a date FURTHER AHEAD than today wins, so a narrated jump forward sticks', () => {
		const skipped = marker(T('October 10, 2026'), 'three weeks pass', T('October 31, 2026'));
		expect(skipped).toMatchObject({ day: S(2026, 10, 31), source: 'time-marker', depth: 0 });
	});

	test('and it keeps winning on later turns, until the clock catches up to it', () => {
		expect(marker(T('October 31, 2026'), 'more talk', 'and more').day).toBe(S(2026, 10, 31));
	});

	test('a date equal to today reads as the clock: the story is keeping step, not jumping', () => {
		expect(marker(T('October 10, 2026'))).toEqual({ day: TODAY, source: 'clock' });
	});

	test('the latest date wins wherever it sits, not the one in the newest turn', () => {
		expect(marker(T('November 5, 2026'), T('October 25, 2026')).day).toBe(S(2026, 11, 5));
	});

	test('depth names the shallowest turn stating the winning date', () => {
		// Two turns state it; a reader looking for where the number came from wants the one
		// they can see without scrolling.
		expect(marker(T('November 5, 2026'), 'talk', T('November 5, 2026')).depth).toBe(0);
	});

	test('depth is absent when the clock answered, because no turn can be named', () => {
		expect(marker('nothing dated here').depth).toBeUndefined();
	});

	test('dropping turns that state EARLIER dates cannot move the answer', () => {
		const full = [T('October 20, 2026'), 'talk', T('November 9, 2026')];
		expect(marker(...full).day).toBe(marker(...full.slice(2)).day);
	});
});

describe('the two marker shapes', () => {
	// Both are read permanently, whichever one the model is currently being told to write.
	// A reader who switches leaves a chat whose older turns are all in the other shape, and a
	// parser that read only the current one would go blind to that history on the switch.
	test('the visible shape parses', () => {
		expect(marker('<Time: 9:00 AM, Tuesday October 20, 2026>').day).toBe(S(2026, 10, 20));
	});

	test('the hidden shape parses, trailing dashes and all', () => {
		expect(marker('<!-- Time: 9:00 AM, Tuesday October 20, 2026 -->').day).toBe(S(2026, 10, 20));
	});

	test('the two agree exactly, so switching shape mid-chat changes no day', () => {
		const visible = marker('<Time: 9:00 AM, Tuesday October 20, 2026>');
		const hidden = marker('<!-- Time: 9:00 AM, Tuesday October 20, 2026 -->');
		expect(visible.day).toBe(hidden.day);
	});

	test('a hidden marker mixed into a visible history is read like any other', () => {
		const mixed = marker(T('October 20, 2026'), '<!-- Time: 9:00 AM, November 4, 2026 -->');
		expect(mixed.day).toBe(S(2026, 11, 4));
	});
});

describe('what a time marker says and does not say', () => {
	test('a date resolves to a serial against a FIXED epoch', () => {
		// Not counted from the first dated turn on the path. That read better and was quietly
		// wrong: the array is only ever the history that is loaded and in budget, so anything
		// derived from its beginning walks forward as a chat grows and every day shifts under
		// it. A fixed origin cannot drift, and the large number costs nothing because a cycle
		// needs `day mod length` and a date-written anchor subtracts the epoch straight out.
		expect(marker(T('November 6, 2026')).day).toBe(S(2026, 11, 6));
	});

	test('what matters is the DIFFERENCE between two dates', () => {
		expect(marker(T('November 9, 2026')).day - marker(T('November 6, 2026')).day).toBe(3);
	});

	test('counts across a month and a year boundary', () => {
		expect(marker(T('January 2, 2027')).day - marker(T('December 30, 2026')).day).toBe(3);
	});

	test('a leap day is a real day', () => {
		expect(marker(T('March 1, 2028')).day - marker(T('February 27, 2028')).day).toBe(3);
	});

	test('abbreviated months work, and the weekday is ignored', () => {
		expect(marker(T('Wed Nov 4, 2026')).day).toBe(S(2026, 11, 4));
		expect(marker(T('Nov. 4, 2026')).day).toBe(S(2026, 11, 4));
		// A weekday that contradicts the date is the model's error, not ours to honour. It is
		// written anyway: a weekday beside a long date gives the model something to check
		// itself against, which is why the marker is not just an ISO date.
		expect(marker(T('Monday November 4, 2026')).day).toBe(S(2026, 11, 4));
	});

	test('the clock time inside says nothing about which day it is', () => {
		const late = marker('<Time: 11:53 PM, November 4, 2026>');
		const early = marker('<Time: 12:04 AM, November 4, 2026>');
		expect(late.day).toBe(early.day);
	});

	test('a marker with no date it understands is ignored rather than guessed at', () => {
		expect(marker('<Time: some time later>').source).toBe('clock');
	});

	test('an ISO date inside a marker is NOT read, which is why the long form is asked for', () => {
		// parseDate's ISO branch is anchored, so it can only match a field that is nothing
		// but a date. Inside a marker the long form is the only one that parses, and a reader
		// who rewrites the entry to use {{isodate}} silently loses the marker.
		expect(marker('<Time: 18:02, Wednesday 2026-11-04>').source).toBe('clock');
	});
});

describe('todaySerial', () => {
	test('reads the LOCAL date, to agree with the marker the model was shown', () => {
		// {{date}} goes through toLocaleDateString, which is the reader's own wall clock.
		// Reading UTC here would disagree with it by a day for most of the world's evening.
		expect(todaySerial(new Date(2026, 9, 10, 23, 30))).toBe(S(2026, 10, 10));
		expect(todaySerial(new Date(2026, 9, 10, 0, 30))).toBe(S(2026, 10, 10));
	});

	test('the time of day makes no difference within one date', () => {
		const open = todaySerial(new Date(2026, 9, 10, 0, 0));
		const close = todaySerial(new Date(2026, 9, 10, 23, 59));
		expect(open).toBe(close);
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

describe('purity', () => {
	test('the same input twice gives the same answer, which the meter and the send rely on', () => {
		const input = {
			messages: [T('November 4, 2026'), 'talk'],
			mode: 'marker' as const,
			manual: 1,
			today: TODAY
		};
		expect(resolveDay(input)).toEqual(resolveDay(input));
	});

	test('nothing here reads a clock: today arrives as an argument', () => {
		// The impurity is one argument at three call sites rather than a hidden read inside a
		// function two meters and a send all run. Pin it and the answer is fixed forever.
		const messages = ['nothing dated'];
		expect(resolveDay({ messages, mode: 'marker', manual: 1, today: 100 }).day).toBe(100);
		expect(resolveDay({ messages, mode: 'marker', manual: 1, today: 500 }).day).toBe(500);
	});

	test('a branch is correct because a path IS a branch', () => {
		// Swiping away the newest turn leaves the path it belonged to, and the day follows.
		const full = [T('November 4, 2026'), T('November 20, 2026')];
		expect(marker(...full).day).toBe(S(2026, 11, 20));
		expect(marker(...full.slice(0, 1)).day).toBe(S(2026, 11, 4));
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
