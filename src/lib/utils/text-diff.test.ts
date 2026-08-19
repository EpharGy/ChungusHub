/**
 * Tests for the word-level composer diff (approve/reject dialog). Run with `bun test`.
 *
 * The reconstruction invariants are the load-bearing property here: whatever segments
 * come out, `equal`+`removed` text must reassemble `before` exactly and `equal`+`added`
 * text must reassemble `after` exactly, whitespace included. That's checked per-case below
 * AND across every case in the shared table, including the oversized-draft cap fallback.
 */

import { describe, expect, test } from 'bun:test';

import { diffWords, type DiffSegment } from './text-diff';

function reconstructBefore(segments: DiffSegment[]): string {
	return segments
		.filter((s) => s.type === 'equal' || s.type === 'removed')
		.map((s) => s.text)
		.join('');
}

function reconstructAfter(segments: DiffSegment[]): string {
	return segments
		.filter((s) => s.type === 'equal' || s.type === 'added')
		.map((s) => s.text)
		.join('');
}

describe('diffWords: segment shapes', () => {
	test('identical strings produce a single equal segment', () => {
		expect(diffWords('Hello there, world!', 'Hello there, world!')).toEqual([
			{ type: 'equal', text: 'Hello there, world!' }
		]);
	});

	test('empty before yields a single added segment', () => {
		expect(diffWords('', 'The hall was dark.')).toEqual([{ type: 'added', text: 'The hall was dark.' }]);
	});

	test('empty after yields a single removed segment', () => {
		expect(diffWords('The hall was dark.', '')).toEqual([{ type: 'removed', text: 'The hall was dark.' }]);
	});

	test('both empty yields no segments', () => {
		expect(diffWords('', '')).toEqual([]);
	});

	test('single word change mid-sentence', () => {
		expect(diffWords('The quick brown fox jumps', 'The quick red fox jumps')).toEqual([
			{ type: 'equal', text: 'The quick ' },
			{ type: 'removed', text: 'brown' },
			{ type: 'added', text: 'red' },
			{ type: 'equal', text: ' fox jumps' }
		]);
	});

	test('change at the very start', () => {
		expect(diffWords('Hello there world', 'Hi there world')).toEqual([
			{ type: 'removed', text: 'Hello' },
			{ type: 'added', text: 'Hi' },
			{ type: 'equal', text: ' there world' }
		]);
	});

	test('change at the very end', () => {
		expect(diffWords('The story ends here', 'The story ends now')).toEqual([
			{ type: 'equal', text: 'The story ends ' },
			{ type: 'removed', text: 'here' },
			{ type: 'added', text: 'now' }
		]);
	});

	test('whitespace-only change: double space collapses to one', () => {
		expect(diffWords('Hello  world', 'Hello world')).toEqual([
			{ type: 'equal', text: 'Hello' },
			{ type: 'removed', text: '  ' },
			{ type: 'added', text: ' ' },
			{ type: 'equal', text: 'world' }
		]);
	});

	test('whitespace-only change: trailing newline added', () => {
		expect(diffWords('Line one.', 'Line one.\n')).toEqual([
			{ type: 'equal', text: 'Line one.' },
			{ type: 'added', text: '\n' }
		]);
	});

	test('multi-line draft: change inside the second paragraph', () => {
		const before = 'Paragraph one is here.\n\nParagraph two starts now.';
		const after = 'Paragraph one is here.\n\nParagraph two begins now.';
		expect(diffWords(before, after)).toEqual([
			{ type: 'equal', text: 'Paragraph one is here.\n\nParagraph two ' },
			{ type: 'removed', text: 'starts' },
			{ type: 'added', text: 'begins' },
			{ type: 'equal', text: ' now.' }
		]);
	});

	test('unicode text: accented word and emoji swapped, CJK untouched', () => {
		const before = 'café ☕ 日本語 test 😀 done';
		const after = 'café ☕ 日本語 test 🙂 done';
		expect(diffWords(before, after)).toEqual([
			{ type: 'equal', text: 'café ☕ 日本語 test ' },
			{ type: 'removed', text: '😀' },
			{ type: 'added', text: '🙂' },
			{ type: 'equal', text: ' done' }
		]);
	});
});

describe('diffWords: quadratic cap', () => {
	test('falls back to a trivial two-segment diff above the cell cap', () => {
		// Both sides share the same space tokens, so an uncapped LCS would align them and
		// produce a long interleaved diff instead of two flat blocks. This confirms the
		// cap actually engaged, not that a coincidentally-simple diff fell out of the content.
		const before = 'alpha '.repeat(800);
		const after = 'beta '.repeat(800);
		expect(diffWords(before, after)).toEqual([
			{ type: 'removed', text: before },
			{ type: 'added', text: after }
		]);
	});
});

describe('diffWords: reconstruction invariants', () => {
	const CASES: Array<[name: string, before: string, after: string]> = [
		['identical strings', 'Hello there, world!', 'Hello there, world!'],
		['empty to text', '', 'The hall was dark.'],
		['text to empty', 'The hall was dark.', ''],
		['both empty', '', ''],
		['word change mid-sentence', 'The quick brown fox jumps', 'The quick red fox jumps'],
		['change at the start', 'Hello there world', 'Hi there world'],
		['change at the end', 'The story ends here', 'The story ends now'],
		['double space collapses to one', 'Hello  world', 'Hello world'],
		['trailing newline added', 'Line one.', 'Line one.\n'],
		[
			'multi-line draft edit',
			'Paragraph one is here.\n\nParagraph two starts now.',
			'Paragraph one is here.\n\nParagraph two begins now.'
		],
		['unicode text', 'café ☕ 日本語 test 😀 done', 'café ☕ 日本語 test 🙂 done'],
		['cap fallback on an oversized draft', 'alpha '.repeat(800), 'beta '.repeat(800)]
	];

	for (const [name, before, after] of CASES) {
		test(`equal+removed reproduces before, equal+added reproduces after: ${name}`, () => {
			const segments = diffWords(before, after);
			expect(reconstructBefore(segments)).toBe(before);
			expect(reconstructAfter(segments)).toBe(after);
		});
	}
});
