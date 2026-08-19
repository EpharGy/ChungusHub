/**
 * The sentences the stats screen is judged on. What is pinned here is the two places a
 * figure could quietly lie: a span that reports a week in seconds, and an average over
 * nothing that reads as a measured zero.
 */
import { describe, it, expect } from 'bun:test';
import { span, average, share, bookComparison, comparisonLabel, plural } from './format';

describe('a span reaches for the units that carry it', () => {
	it('climbs from seconds to days', () => {
		expect(span(500)).toBe('under a second');
		expect(span(45_000)).toBe('45 seconds');
		expect(span(90_000)).toBe('1 minute');
		expect(span(20 * 60_000)).toBe('20 minutes');
		expect(span(3 * 3600_000)).toBe('3 hours');
		expect(span(3 * 3600_000 + 20 * 60_000)).toBe('3 hours 20 minutes');
		expect(span(50 * 3600_000)).toBe('2 days 2 hours');
	});

	it('drops an empty remainder rather than saying zero of it', () => {
		expect(span(48 * 3600_000)).toBe('2 days');
		expect(span(2 * 3600_000)).toBe('2 hours');
	});
});

describe('an average refuses to divide by nothing', () => {
	it('is null when nothing was measured, never zero', () => {
		expect(average(0, 0)).toBeNull();
		expect(share(0, 0)).toBeNull();
	});

	it('divides normally otherwise', () => {
		expect(average(10_000, 4)).toBe(2500);
		expect(share(1, 4)).toBe(25);
	});
});

describe('the book comparison', () => {
	it('has nothing to say below the smallest book', () => {
		expect(bookComparison(0)).toBeNull();
		expect(bookComparison(26_999)).toBeNull();
	});

	it('takes the largest book that fits, not the closest one', () => {
		expect(bookComparison(100_000)?.title).toBe('The Hobbit');
		expect(bookComparison(300_000)?.title).toBe('Moby-Dick');
		expect(bookComparison(600_000)?.title).toBe('War and Peace');
	});

	it('counts the times over once nothing bigger fits', () => {
		expect(bookComparison(190_000)).toEqual({ title: 'The Hobbit', times: 2 });
		expect(bookComparison(1_200_000)).toEqual({ title: 'War and Peace', times: 2 });
	});

	it('says the number of times in words a person would use', () => {
		expect(comparisonLabel({ title: 'The Hobbit', times: 1 })).toBe('The Hobbit');
		expect(comparisonLabel({ title: 'The Hobbit', times: 2 })).toBe('The Hobbit, twice over');
		expect(comparisonLabel({ title: 'War and Peace', times: 5 })).toBe('War and Peace, 5 times over');
	});
});

describe('units agree with their number', () => {
	it('turns one chat singular and everything else plural', () => {
		expect(plural(1, 'chat')).toBe('1 chat');
		expect(plural(0, 'chat')).toBe('0 chats');
		expect(plural(2, 'story', 'stories')).toBe('2 stories');
	});
});
