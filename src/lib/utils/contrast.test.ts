/**
 * The palette editor's readout is the one thing that makes handing a reader the app's
 * own colors safe, so the arithmetic behind it is pinned against WCAG's own reference
 * points rather than against whatever it happened to return first. Run with `bun test`.
 */
import { describe, test, expect } from 'bun:test';
import { contrastRatio, contrastVerdict, readContrast } from './contrast';

describe('contrast (architecture/ui-shell-settings.md, the palette editor)', () => {
	test('the two extremes are the scale', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#7a7a7a', '#7a7a7a')).toBeCloseTo(1, 5);
	});

	test('order does not change the reading', () => {
		expect(contrastRatio('#131417', '#edeef1')).toBeCloseTo(
			contrastRatio('#edeef1', '#131417'),
			10
		);
	});

	test('the shipped default palette clears the body-text floor', () => {
		// Graphite's primary ink on its base surface, the pair every other surface in the
		// app is measured against. A change to presets.ts that broke this would make the
		// house default the first thing the editor flagged.
		expect(contrastRatio('#edeef1', '#131417')).toBeGreaterThan(4.5);
	});

	test('a verdict is pass, tight or fail against the floor it was given', () => {
		expect(contrastVerdict(4.6, 4.5)).toBe('pass');
		expect(contrastVerdict(4.5, 4.5)).toBe('pass');
		// Legible large, not legible small: the band the reader has to judge for themselves.
		expect(contrastVerdict(3.4, 4.5)).toBe('tight');
		expect(contrastVerdict(2.9, 4.5)).toBe('fail');
		// The same ratio reads differently under a lower floor, which is the whole point
		// of carrying the floor per row instead of one constant.
		expect(contrastVerdict(3.4, 3)).toBe('pass');
	});

	test('a reading carries its own check back', () => {
		const reading = readContrast({
			label: 'Text on the workspace',
			ink: '#ffffff',
			surface: '#000000',
			floor: 4.5
		});
		expect(reading.label).toBe('Text on the workspace');
		expect(reading.ratio).toBeCloseTo(21, 5);
		expect(reading.verdict).toBe('pass');
	});

	test('anything that is not a #rrggbb hex fails loudly', () => {
		// A palette stores nothing else, so a value reaching here in another notation is a
		// bug upstream, and a parser that shrugged would hide it behind a plausible number.
		expect(() => contrastRatio('rgb(0 0 0 / 66%)', '#ffffff')).toThrow();
		expect(() => contrastRatio('#fff', '#ffffff')).toThrow();
	});
});
