/**
 * Tests for the hint label alphabet. Run with `bun test`.
 *
 * Only the pure half is covered: which labels exist for a count, and the prefix-free property
 * the typing loop depends on. Collecting the targets and drawing the badges is DOM glue and
 * is exercised by hand in the app.
 */

import { describe, expect, test } from 'bun:test';

import { hintLabels, HINT_ALPHABET } from './hints';

describe('hintLabels', () => {
	test('nothing on screen means no labels', () => {
		expect(hintLabels(0)).toEqual([]);
		expect(hintLabels(-1)).toEqual([]);
	});

	test('a screen inside the alphabet is single letters', () => {
		expect(hintLabels(3)).toEqual(['a', 's', 'd']);
		expect(hintLabels(HINT_ALPHABET.length)).toHaveLength(HINT_ALPHABET.length);
		expect(hintLabels(HINT_ALPHABET.length).every((label) => label.length === 1)).toBe(true);
	});

	test('one target past the alphabet moves the whole screen to pairs', () => {
		const labels = hintLabels(HINT_ALPHABET.length + 1);
		expect(labels.every((label) => label.length === 2)).toBe(true);
		expect(labels[0]).toBe('aa');
		expect(labels[1]).toBe('as');
	});

	test('labels are unique and prefix-free at every size', () => {
		for (const count of [1, 9, 10, 81, 82, 300]) {
			const labels = hintLabels(count);
			expect(labels).toHaveLength(count);
			expect(new Set(labels).size).toBe(count);
			// Same length throughout is what makes them prefix-free: no label can be the start
			// of another, so a completed spelling is never ambiguous.
			expect(new Set(labels.map((label) => label.length)).size).toBe(1);
		}
	});

	test('an alphabet that cannot name two targets is a fault, not a silent fallback', () => {
		expect(() => hintLabels(2, 'a')).toThrow();
	});
});
