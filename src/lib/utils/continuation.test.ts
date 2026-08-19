/**
 * Tests for the continuation joining rules (continue-in-place). Run with `bun test`.
 *
 * glueContinuation is the seam rule the live stream preview uses; joinContinuation is the
 * persisted result (restatement trim + glue). The trim thresholds matter: overlaps shorter
 * than the minimum are coincidence and must survive, longer ones are model restatement and
 * must not be appended twice.
 */

import { describe, expect, test } from 'bun:test';

import { glueContinuation, joinContinuation } from './continuation';

describe('glueContinuation: seam rule', () => {
	test('empty base takes the continuation with leading whitespace dropped', () => {
		expect(glueContinuation('', '  The hall was dark.')).toBe('The hall was dark.');
	});

	test('empty continuation returns the base unchanged', () => {
		expect(glueContinuation('The hall was dark.', '')).toBe('The hall was dark.');
	});

	test('raw concat when the base ends with whitespace', () => {
		expect(glueContinuation('The hall was ', 'dark.')).toBe('The hall was dark.');
	});

	test('raw concat when the continuation starts with whitespace', () => {
		expect(glueContinuation('The hall was dark.', '\n\nBeyond it, silence.')).toBe(
			'The hall was dark.\n\nBeyond it, silence.'
		);
	});

	test('raw concat when the continuation opens with gluing punctuation', () => {
		expect(glueContinuation('She hesitated', ', then stepped forward.')).toBe('She hesitated, then stepped forward.');
		expect(glueContinuation('He said "run', '." and vanished.')).toBe('He said "run." and vanished.');
	});

	test('inserts a single space at a bare word boundary', () => {
		expect(glueContinuation('The knight drew his blade and', 'charged the gate.')).toBe(
			'The knight drew his blade and charged the gate.'
		);
	});
});

describe('joinContinuation: restatement trimming', () => {
	test('no overlap appends with the seam rule', () => {
		expect(joinContinuation('The knight drew his blade and', 'charged the gate.')).toBe(
			'The knight drew his blade and charged the gate.'
		);
	});

	test('a restated tail of the base is stripped before appending', () => {
		const base = 'They stopped before the ancient stone door.';
		const next = 'the ancient stone door. Beyond it lay darkness.';
		expect(joinContinuation(base, next)).toBe('They stopped before the ancient stone door. Beyond it lay darkness.');
	});

	test('short coincidental overlaps are kept', () => {
		// "Karak" is a real suffix of the base, but far below the minimum overlap length.
		expect(joinContinuation('The road led to Karak', 'Karak was silent that night.')).toBe(
			'The road led to Karak Karak was silent that night.'
		);
	});

	test('a whole-message restatement keeps only the new text', () => {
		const base = 'The knight rose from the table.';
		expect(joinContinuation(base, base + ' He walked into the rain.')).toBe(
			'The knight rose from the table. He walked into the rain.'
		);
	});

	test('a pure restatement returns the base unchanged', () => {
		const base = 'The knight rose from the table.';
		expect(joinContinuation(base, base)).toBe(base);
	});

	test('whitespace-only continuation returns the base unchanged', () => {
		expect(joinContinuation('The hall was dark.', '  \n ')).toBe('The hall was dark.');
	});

	test('trailing whitespace on the base does not defeat restatement detection', () => {
		const base = 'He paused mid-sentence and \n';
		const joined = joinContinuation(base, 'He paused mid-sentence and then spoke.');
		// The restated words are stripped; what remains (leading space included) rides
		// after the base's own trailing whitespace untouched.
		expect(joined).toBe(base + ' then spoke.');
	});
});
