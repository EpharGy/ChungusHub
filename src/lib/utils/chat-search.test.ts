/**
 * Tests for the find-in-chat matcher. Run with `bun test`.
 *
 * Only the pure half is covered here: buildSearchRegex decides what counts as a match, and
 * every subtle rule lives in it (literal escaping under the `u` flag, case folding, and the
 * Unicode word boundary that ASCII \b gets wrong past ASCII). findMatchRanges is the DOM
 * glue around it and is exercised by hand in the app.
 */

import { describe, expect, test } from 'bun:test';

import { buildSearchRegex, findBranchHits } from './chat-search';

/** How many times the query matches, the only thing the bar asks the regex for. */
function count(haystack: string, query: string, opts?: { matchCase?: boolean; wholeWord?: boolean }) {
	const regex = buildSearchRegex(query, {
		matchCase: opts?.matchCase ?? false,
		wholeWord: opts?.wholeWord ?? false
	});
	if (!regex) throw new Error('expected a regex');
	return [...haystack.matchAll(regex)].length;
}

describe('buildSearchRegex: nothing to search for', () => {
	test('an empty query has no matcher', () => {
		expect(buildSearchRegex('', { matchCase: false, wholeWord: false })).toBeNull();
	});

	test('whitespace is a real query, not an empty one', () => {
		expect(count('a b c', ' ')).toBe(2);
	});
});

describe('buildSearchRegex: the query is a literal', () => {
	test('a dot matches only a dot', () => {
		expect(count('axb a.b', 'a.b')).toBe(1);
	});

	test('regex metacharacters are searched verbatim', () => {
		expect(count('the (parenthetical) aside', '(parenthetical)')).toBe(1);
		expect(count('a [bracket] and a {brace}', '[bracket]')).toBe(1);
		expect(count('one + one', '+')).toBe(1);
		expect(count('c:\\path', '\\')).toBe(1);
	});

	test('characters that are illegal escapes under the `u` flag survive unescaped', () => {
		// `\-` and `\/` are SyntaxErrors in unicode mode, so they must not be escaped.
		expect(count('half-open and/or shut', '-')).toBe(1);
		expect(count('half-open and/or shut', '/')).toBe(1);
	});
});

describe('buildSearchRegex: case', () => {
	test('case-insensitive by default', () => {
		expect(count('Door door DOOR', 'door')).toBe(3);
	});

	test('match case pins the exact casing', () => {
		expect(count('Door door DOOR', 'door', { matchCase: true })).toBe(1);
	});

	test('the dotless i folds onto I (Unicode alone would miss KAPI)', () => {
		expect(count('Kapı kapı KAPI', 'kapı')).toBe(3);
	});

	test('the dotted İ folds onto i (Unicode alone would miss İstanbul)', () => {
		expect(count('İstanbul istanbul ISTANBUL', 'istanbul')).toBe(3);
	});

	test('match case keeps all four i letters distinct', () => {
		expect(count('kapı kapi KAPI Kapİ', 'kapı', { matchCase: true })).toBe(1);
		expect(count('kapı kapi KAPI Kapİ', 'kapi', { matchCase: true })).toBe(1);
	});
});

describe('buildSearchRegex: whole words', () => {
	test('off by default: a substring still matches', () => {
		expect(count('kişisel', 'kişi')).toBe(1);
	});

	test('on: a substring inside a longer word is rejected', () => {
		expect(count('kişisel', 'kişi', { wholeWord: true })).toBe(0);
	});

	test('on: the standalone word still matches', () => {
		expect(count('bir kişi geldi', 'kişi', { wholeWord: true })).toBe(1);
	});

	test('a word starting with a non-ASCII letter matches (ASCII \\b never would)', () => {
		expect(count('bir şey var', 'şey', { wholeWord: true })).toBe(1);
	});

	test('a non-ASCII letter is a real boundary, not a gap (ASCII \\b would match here)', () => {
		expect(count('şeyler', 'eyler', { wholeWord: true })).toBe(0);
	});

	test('punctuation and line breaks bound a word', () => {
		expect(count('"kapı", dedi.\nkapı', 'kapı', { wholeWord: true })).toBe(2);
	});

	test('digits and underscores bind like letters', () => {
		expect(count('turn_2 turn 2', 'turn', { wholeWord: true })).toBe(1);
	});
});

describe('findBranchHits: off-path turns', () => {
	const regex = () => buildSearchRegex('kapı', { matchCase: false, wholeWord: false })!;

	test('only turns that match come back, in the order given', () => {
		const hits = findBranchHits(
			[
				{ id: 'a', role: 'user', text: 'nothing here' },
				{ id: 'b', role: 'assistant', text: 'the kapı creaks' },
				{ id: 'c', role: 'user', text: 'KAPI again and kapı once more' }
			],
			regex(),
			10
		);
		expect(hits.map((h) => h.messageId)).toEqual(['b', 'c']);
		expect(hits.map((h) => h.count)).toEqual([1, 2]);
		expect(hits[0].role).toBe('assistant');
	});

	test('a short turn is snippeted whole, with no ellipses', () => {
		const hits = findBranchHits([{ id: 'a', role: 'user', text: 'the kapı creaks' }], regex(), 10);
		expect(hits[0].snippet).toBe('the kapı creaks');
	});

	test('a long turn is trimmed around the FIRST match and ellipsed at both ends', () => {
		const text = `${'x'.repeat(200)} kapı ${'y'.repeat(200)}`;
		const snippet = findBranchHits([{ id: 'a', role: 'user', text }], regex(), 10)[0].snippet;
		expect(snippet.startsWith('…')).toBe(true);
		expect(snippet.endsWith('…')).toBe(true);
		expect(snippet).toContain('kapı');
		expect(snippet.length).toBeLessThan(140);
	});

	test('newlines collapse so a row stays one line', () => {
		const hits = findBranchHits([{ id: 'a', role: 'user', text: 'the\n\n  kapı\ncreaks' }], regex(), 10);
		expect(hits[0].snippet).toBe('the kapı creaks');
	});

	test('the budget caps the rows, it never silently drops matches from a row', () => {
		const turns = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, role: 'user', text: 'kapı kapı' }));
		const hits = findBranchHits(turns, regex(), 2);
		expect(hits).toHaveLength(2);
		expect(hits[0].count).toBe(2);
	});

	test('a zero budget returns nothing rather than one row', () => {
		expect(findBranchHits([{ id: 'a', role: 'user', text: 'kapı' }], regex(), 0)).toEqual([]);
	});
});
