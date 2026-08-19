import { describe, test, expect } from 'bun:test';
import { dayBucket, formatDate, formatRelativeTime } from './date';

/** A local-time timestamp, so the tests read the same way the UI does. */
function at(y: number, m: number, d: number, h = 12, min = 0): number {
	return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

describe('dayBucket', () => {
	const now = at(2026, 7, 24, 14);

	test('counts calendar days, not 24-hour spans', () => {
		// 02:00 today and 23:00 yesterday are 3 hours apart but different days.
		expect(dayBucket(at(2026, 7, 24, 2), at(2026, 7, 24, 5))).toBe('today');
		expect(dayBucket(at(2026, 7, 23, 23), at(2026, 7, 24, 2))).toBe('yesterday');
	});

	test('walks out through the wider buckets', () => {
		expect(dayBucket(at(2026, 7, 24, 9), now)).toBe('today');
		expect(dayBucket(at(2026, 7, 23), now)).toBe('yesterday');
		expect(dayBucket(at(2026, 7, 20), now)).toBe('week');
		expect(dayBucket(at(2026, 7, 18), now)).toBe('week');
		expect(dayBucket(at(2026, 7, 17), now)).toBe('month');
		expect(dayBucket(at(2026, 6, 25), now)).toBe('month');
		expect(dayBucket(at(2026, 6, 24), now)).toBe('older');
	});

	test('a future timestamp reads as today instead of going negative', () => {
		expect(dayBucket(at(2026, 7, 26), now)).toBe('today');
	});
});

describe('formatRelativeTime', () => {
	const now = at(2026, 7, 24, 14);

	test('seconds collapse to Just now', () => {
		expect(formatRelativeTime(now - 5_000, now)).toBe('Just now');
		expect(formatRelativeTime(now + 60_000, now)).toBe('Just now');
	});

	test('minutes, then hours', () => {
		expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
		expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59m ago');
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
	});

	test('never prints a zero band at a boundary', () => {
		// 45s..59s must not floor to "0m", and 23h35m must not round up past the hours
		// band into a calendar-day count of zero ("0d ago" while the row sits in Today).
		expect(formatRelativeTime(now - 50_000, now)).toBe('1m ago');
		expect(formatRelativeTime(at(2026, 7, 24, 0, 10), at(2026, 7, 24, 23, 45))).toBe('23h ago');
		expect(formatRelativeTime(now - 3_599_000, now)).toBe('59m ago');
		expect(formatRelativeTime(now - 86_399_000, now)).toBe('23h ago');
	});

	test('then calendar days, then the plain date', () => {
		expect(formatRelativeTime(at(2026, 7, 23, 9), now)).toBe('Yesterday');
		expect(formatRelativeTime(at(2026, 7, 21), now)).toBe('3d ago');
		expect(formatRelativeTime(at(2026, 7, 1), now)).toBe(formatDate(at(2026, 7, 1)));
	});
});
