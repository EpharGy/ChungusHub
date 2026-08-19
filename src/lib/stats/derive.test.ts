/**
 * The client half of the stats maths: turning the server's zone-free buckets into the
 * reader's own days.
 *
 * The cases worth pinning are the ones a reader would notice and could never explain: a
 * streak broken at a midnight that is not theirs, a run that survives a clock change, and
 * a "still going" streak declared dead at breakfast because nothing had been written yet
 * that morning.
 */
import { describe, it, expect } from 'bun:test';
import {
	toActiveDays,
	longestStreak,
	currentStreak,
	hourHistogram,
	busiestDay,
	primeHours,
	startOfLocalDay,
	nextLocalDay
} from './derive';

/** A bucket at a local wall-clock time, so these cases read the way a reader lived them. */
function at(y: number, m: number, d: number, hour = 12, minute = 0): number {
	return new Date(y, m - 1, d, hour, minute).getTime();
}

const day = (y: number, m: number, d: number, count = 1, hour = 12): [number, number] => [
	at(y, m, d, hour),
	count
];

describe('folding buckets into local days', () => {
	it('gathers every bucket of a day under one key and sorts oldest first', () => {
		const days = toActiveDays([day(2026, 3, 2, 3, 9), day(2026, 3, 1, 1), day(2026, 3, 2, 4, 21)]);
		expect(days.map((d) => d.key)).toEqual(['2026-03-01', '2026-03-02']);
		expect(days[1].count).toBe(7);
	});

	it('files a late-night message under the day the reader was living', () => {
		// 23:50 and 00:10 are one hour apart and belong to different days. A UTC fold would
		// put them together or split them somewhere else entirely, depending on the zone.
		const days = toActiveDays([day(2026, 3, 1, 1, 23), day(2026, 3, 2, 1, 0)]);
		expect(days).toHaveLength(2);
		expect(days[0].key).toBe('2026-03-01');
		expect(days[1].key).toBe('2026-03-02');
	});

	it('answers nothing with nothing', () => {
		expect(toActiveDays([])).toEqual([]);
	});
});

describe('stepping a day at a time', () => {
	it('lands on the next midnight, including the days a clock change makes short or long', () => {
		// Whatever this machine's zone does at the end of March and October, a step is one
		// calendar day: it lands on midnight, and it is never the 24 hours a naive add would
		// give (which is what would leave a streak broken once a year).
		for (const [m, d] of [
			[3, 28],
			[3, 29],
			[10, 24],
			[10, 25],
			[12, 31]
		]) {
			const from = startOfLocalDay(at(2026, m, d));
			const to = nextLocalDay(from);
			expect(new Date(to).getHours()).toBe(0);
			expect(new Date(to).getDate()).toBe(new Date(from + 36 * 3600_000).getDate());
			expect(to - from).toBeGreaterThanOrEqual(23 * 3600_000);
			expect(to - from).toBeLessThanOrEqual(25 * 3600_000);
		}
	});
});

describe('the longest streak', () => {
	it('counts a consecutive run and names its ends', () => {
		const days = toActiveDays([day(2026, 3, 1), day(2026, 3, 2), day(2026, 3, 3), day(2026, 3, 7)]);
		expect(longestStreak(days)).toEqual({ days: 3, from: '2026-03-01', to: '2026-03-03' });
	});

	it('breaks on a missed day rather than on a gap in the numbers', () => {
		const days = toActiveDays([day(2026, 3, 1), day(2026, 3, 3), day(2026, 3, 4)]);
		expect(longestStreak(days).days).toBe(2);
	});

	it('runs across a month end', () => {
		const days = toActiveDays([day(2026, 1, 30), day(2026, 1, 31), day(2026, 2, 1)]);
		expect(longestStreak(days).days).toBe(3);
	});

	it('keeps the earliest of two equal runs: a record is when it was first set', () => {
		const days = toActiveDays([day(2026, 3, 1), day(2026, 3, 2), day(2026, 3, 10), day(2026, 3, 11)]);
		expect(longestStreak(days)).toEqual({ days: 2, from: '2026-03-01', to: '2026-03-02' });
	});

	it('calls one lone day a streak of one', () => {
		expect(longestStreak(toActiveDays([day(2026, 3, 1)])).days).toBe(1);
	});

	it('answers nothing with zero and no ends', () => {
		expect(longestStreak([])).toEqual({ days: 0, from: null, to: null });
	});
});

describe('the streak still running', () => {
	it('holds while nothing has been written yet today', () => {
		// Read at breakfast: yesterday's run is alive until a whole day passes empty.
		const days = toActiveDays([day(2026, 3, 1), day(2026, 3, 2), day(2026, 3, 3)]);
		expect(currentStreak(days, at(2026, 3, 4, 8)).days).toBe(3);
	});

	it('counts today in when today has already been written in', () => {
		const days = toActiveDays([day(2026, 3, 2), day(2026, 3, 3), day(2026, 3, 4)]);
		expect(currentStreak(days, at(2026, 3, 4, 23)).days).toBe(3);
	});

	it('is over once a whole day has passed with nothing in it', () => {
		const days = toActiveDays([day(2026, 3, 1), day(2026, 3, 2)]);
		expect(currentStreak(days, at(2026, 3, 5)).days).toBe(0);
	});

	it('reads only the tail, never the best run in the past', () => {
		const days = toActiveDays([
			day(2026, 3, 1),
			day(2026, 3, 2),
			day(2026, 3, 3),
			day(2026, 3, 10)
		]);
		expect(currentStreak(days, at(2026, 3, 10, 20)).days).toBe(1);
	});
});

describe('the shape of a day', () => {
	it('puts each bucket in the reader’s own hour', () => {
		const hours = hourHistogram([day(2026, 3, 1, 2, 23), day(2026, 3, 1, 3, 9), day(2026, 3, 2, 1, 23)]);
		expect(hours).toHaveLength(24);
		expect(hours[23]).toBe(3);
		expect(hours[9]).toBe(3);
		expect(hours[4]).toBe(0);
	});

	it('finds the narrowest window holding half of everything', () => {
		const hours = new Array<number>(24).fill(0);
		hours[21] = 40;
		hours[22] = 40;
		hours[3] = 10;
		expect(primeHours(hours)).toEqual([21, 22]);
	});

	it('wraps a window around midnight rather than cutting it', () => {
		// The late-night reader: their habit straddles the date line, and any window that
		// refused to wrap would have to report one of the two halves instead.
		const hours = new Array<number>(24).fill(0);
		hours[23] = 30;
		hours[0] = 30;
		hours[12] = 40;
		expect(primeHours(hours)).toEqual([23, 0]);
	});

	it('calls one hour the window when one hour really is half of it', () => {
		const hours = new Array<number>(24).fill(0);
		hours[21] = 60;
		hours[9] = 40;
		expect(primeHours(hours)).toEqual([21, 21]);
	});

	it('has no window when nothing was written', () => {
		expect(primeHours(new Array<number>(24).fill(0))).toBeNull();
	});
});

describe('the busiest day', () => {
	it('picks the heaviest and keeps the earliest of a tie', () => {
		const days = toActiveDays([day(2026, 3, 1, 5), day(2026, 3, 2, 9), day(2026, 3, 3, 9)]);
		expect(busiestDay(days)?.key).toBe('2026-03-02');
	});

	it('answers nothing with null', () => {
		expect(busiestDay([])).toBeNull();
	});
});
