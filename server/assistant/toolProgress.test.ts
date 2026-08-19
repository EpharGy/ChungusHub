/**
 * The display line the assistant panel shows while a tool call's arguments stream in.
 *
 * Every case here is a fragment a provider actually hands over mid-stream: unterminated
 * strings, a split escape, arguments that are nothing but ids and enums. The function is
 * pure and imports nothing, so this file needs no database dance.
 */
import { describe, test, expect } from 'bun:test';
import { toolProgressText } from './toolProgress';

/** Long enough to clear the "nothing worth watching" floor. */
const PROSE = 'She set the lantern down on the frost-bitten stone and waited for the sound to come again.';

describe('toolProgressText', () => {
	test('shows the value the model is still writing, unterminated', () => {
		expect(toolProgressText(`{"kind":"character","id":"abc","field":"description","value":"${PROSE}`)).toBe(PROSE);
	});

	test('keeps the longest value when a short argument follows it', () => {
		// The final frames of an edit write `reason` after a 3000-character rewrite; the
		// panel must not flip to "typo" for them.
		expect(toolProgressText(`{"replace":"${PROSE}","reason":"typo"}`)).toBe(PROSE);
	});

	test('reads values nested inside an object argument', () => {
		expect(toolProgressText(`{"kind":"character","fields":{"name":"Aria","description":"${PROSE}"}}`)).toBe(PROSE);
	});

	test('reads values inside an array', () => {
		expect(toolProgressText(`{"keys":["short","${PROSE}"]}`)).toBe(PROSE);
	});

	test('never shows a key, however long', () => {
		const key = 'a'.repeat(120);
		expect(toolProgressText(`{"${key}":"x"}`)).toBe('');
	});

	test('says nothing for arguments that are only ids, enums and numbers', () => {
		expect(toolProgressText('{"kind":"character","id":"9f3c-2","limit":30,"scope":"this_only"}')).toBe('');
		expect(toolProgressText('{}')).toBe('');
		expect(toolProgressText('')).toBe('');
	});

	test('says nothing for a fragment too short to mean anything yet', () => {
		expect(toolProgressText('{"value":"She set the lan')).toBe('');
	});

	test('decodes escapes and collapses the text onto one line', () => {
		const raw = String.raw`{"value":"Line one.\n\nLine two — \"quoted\" and \\ escaped, ${'x'.repeat(40)}"}`; // em-dash: data
		expect(toolProgressText(raw)).toBe(`Line one. Line two — "quoted" and \\ escaped, ${'x'.repeat(40)}`); // em-dash: data
	});

	test('survives a fragment cut in the middle of an escape', () => {
		expect(toolProgressText(`{"value":"${PROSE}\\`)).toBe(PROSE);
		expect(toolProgressText(`{"value":"${PROSE}\\u00e`)).toBe(PROSE);
	});

	test('decodes a complete unicode escape', () => {
		expect(toolProgressText(`{"value":"${PROSE}\\u00e9"}`)).toBe(`${PROSE}é`);
	});

	test('shows the tail, marked, once the value outgrows one line', () => {
		const long = 'x'.repeat(500) + 'THE END';
		const out = toolProgressText(`{"value":"${long}`);
		expect(out.startsWith('…')).toBe(true);
		expect(out.endsWith('THE END')).toBe(true);
		expect(out.length).toBe(201);
	});

	test('degrades to an empty line on a fragment that is not JSON at all', () => {
		expect(toolProgressText('not json, not even close')).toBe('');
	});
});
