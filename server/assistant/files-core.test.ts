/**
 * Recognition, normalization and the line math behind attached files.
 *
 * Every recognition case here is a real on-disk shape from the formats this app already
 * reads (architecture/sillytavern-interchange.md), reduced to the fields detection actually
 * keys on. The module is pure and imports nothing, so this file needs no data dir.
 */
import { describe, test, expect } from 'bun:test';
import {
	clampRange,
	countLines,
	detectFileKind,
	MATCH_LINE_CLIP,
	normalizeText,
	prettyJson,
	renderNumbered,
	searchFile,
	splitLines
} from './files-core';

describe('normalizeText', () => {
	test('drops a BOM and folds CRLF to LF', () => {
		expect(normalizeText('﻿one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
	});

	test('leaves an already-clean file alone', () => {
		expect(normalizeText('one\ntwo')).toBe('one\ntwo');
	});
});

describe('detectFileKind', () => {
	test('a V2 card by its nested greeting field', () => {
		const card = JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Aria', first_mes: 'Hello.' } });
		expect(detectFileKind(card)).toBe('sillytavern-card');
	});

	test('a V1 card by its flat greeting field', () => {
		expect(detectFileKind(JSON.stringify({ name: 'Aria', first_mes: 'Hello.' }))).toBe('sillytavern-card');
	});

	test('a card carrying an embedded book is still a card', () => {
		// Order matters: a card may embed a character_book and would otherwise read as a book.
		const card = JSON.stringify({ data: { first_mes: 'Hello.', character_book: { entries: [] } } });
		expect(detectFileKind(card)).toBe('sillytavern-card');
	});

	test('native world info by its uid-keyed entries object', () => {
		expect(detectFileKind(JSON.stringify({ entries: { '0': { key: ['tower'] } } }))).toBe('world-info');
	});

	test('character_book world info by its entries array', () => {
		expect(detectFileKind(JSON.stringify({ entries: [{ keys: ['tower'] }] }))).toBe('world-info');
	});

	test('a regex script by its find string, alone or in a list', () => {
		expect(detectFileKind(JSON.stringify({ findRegex: '/x/g', replaceString: 'y' }))).toBe('regex-script');
		expect(detectFileKind(JSON.stringify([{ findRegex: '/x/g' }, { findRegex: '/z/' }]))).toBe('regex-script');
	});

	test('a preset by its items plus the assembly settings only a preset carries', () => {
		expect(detectFileKind(JSON.stringify({ name: 'P', items: [], exampleSeparator: '***' }))).toBe('chungus-preset');
		// An items array on its own is not a preset.
		expect(detectFileKind(JSON.stringify({ items: [1, 2] }))).toBe('json');
	});

	test("this app's own two envelopes by their marker", () => {
		expect(detectFileKind(JSON.stringify({ format: 'chungushub.libraryEntry' }))).toBe('chungus-library-entry');
		expect(detectFileKind(JSON.stringify({ type: 'chungushub.assistantSkills', skills: [] }))).toBe('chungus-skills');
	});

	test('a SillyTavern chat by its header line', () => {
		const chat = ['{"chat_metadata":{},"user_name":"You"}', '{"mes":"Hi","is_user":true}'].join('\n');
		expect(detectFileKind(chat)).toBe('sillytavern-chat');
	});

	test('plain JSON Lines with no chat header', () => {
		expect(detectFileKind('{"a":1}\n{"a":2}')).toBe('jsonl');
	});

	test('prose that merely opens with a brace is text, not JSONL', () => {
		expect(detectFileKind('{not json\nand another line')).toBe('text');
	});

	test('an empty file is text', () => {
		expect(detectFileKind('   \n  ')).toBe('text');
	});
});

describe('prettyJson', () => {
	test('re-prints a minified document so it has lines to address', () => {
		// The whole reason this exists: a one-line 400KB world info cannot be range-read
		// or usefully searched, because every match reports line 1.
		const minified = '{"entries":{"0":{"key":["tower"]}}}';
		expect(countLines(minified)).toBe(1);
		expect(countLines(prettyJson(minified)!)).toBeGreaterThan(4);
	});

	test('returns null for text that is not JSON', () => {
		expect(prettyJson('just prose')).toBeNull();
	});
});

describe('line math', () => {
	test('a trailing newline does not open a final empty line', () => {
		expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
		expect(countLines('a\nb\n')).toBe(2);
		expect(countLines('')).toBe(0);
	});

	test('the gutter width follows the file, so it never jitters mid-read', () => {
		expect(renderNumbered(['x', 'y'], 9, 120)).toBe('  9 | x\n 10 | y');
	});

	test('a range is clamped to what the file has', () => {
		expect(clampRange(10, 4, 6)).toEqual({ from: 4, to: 6 });
		expect(clampRange(10, 8, 999)).toEqual({ from: 8, to: 10 });
		expect(clampRange(10)).toEqual({ from: 1, to: 10 });
		// `to` before `from` reads as the single line asked for, never an inverted slice.
		expect(clampRange(10, 6, 2)).toEqual({ from: 6, to: 6 });
	});

	test('an empty file yields an empty range, not a phantom line 1', () => {
		expect(clampRange(0)).toEqual({ from: 0, to: -1 });
	});
});

describe('searchFile', () => {
	const text = ['The tower stands.', 'Aria waits.', 'the TOWER falls.'].join('\n');

	test('case-insensitive by default, with real line numbers', () => {
		const result = searchFile(text, 'tower', false, 10);
		expect(result.total).toBe(2);
		expect(result.matches.map((m) => m.line)).toEqual([1, 3]);
	});

	test('case-sensitive when asked', () => {
		expect(searchFile(text, 'TOWER', true, 10).total).toBe(1);
	});

	test('the page is bounded but the total is honest', () => {
		const result = searchFile(text, 'the', false, 1);
		expect(result.matches).toHaveLength(1);
		expect(result.total).toBe(2);
	});

	test('a match on a huge line is clipped, so one hit cannot dump the file', () => {
		const long = `prefix ${'x'.repeat(5000)}`;
		const result = searchFile(long, 'prefix', false, 10);
		expect(result.matches[0].text).toHaveLength(MATCH_LINE_CLIP + 1);
		expect(result.matches[0].text.endsWith('…')).toBe(true);
	});
});
