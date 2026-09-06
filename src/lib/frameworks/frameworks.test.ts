/**
 * Framework base tests. Run with `bun test`.
 *
 * Locks the two contracts the base owns, neither of which involves any actual framework:
 * the marker grammar (a positional key then named fields, with every malformed shape
 * rejected by name rather than guessed at), and the dispatcher's promise that a marker
 * nothing claimed is REMOVED from the prompt and explained in a record.
 *
 * Everything here runs against a fake framework declared in the test, deliberately: the
 * base branch must be provable without a real one existing.
 */

import { describe, expect, test } from 'bun:test';

import { applyFrameworks } from './dispatch';
import { findMarkers, hasMarker } from './marker';
import type { FrameworkComputeInput, FrameworkContext, FrameworkDef } from './types';

/** A framework that echoes what it was handed, so tests can assert on the whole input. */
function fake(compute: (input: FrameworkComputeInput) => string | null): FrameworkDef {
	return {
		id: 'demo',
		name: 'Demo',
		summary: 'test double',
		description: 'test double',
		compute
	};
}

function ctx(over: Partial<FrameworkContext> = {}): FrameworkContext {
	return {
		frameworks: [fake(({ key }) => `<${key}>`)],
		disabled: [],
		day: 1,
		suppressed: [],
		byFramework: {},
		...over
	};
}

describe('marker grammar', () => {
	test('parses a positional key followed by named fields', () => {
		const [marker] = findMarkers('Status: @demo[rowan, len=27, start=12]');
		expect(marker.frameworkId).toBe('demo');
		expect(marker.key).toBe('rowan');
		expect(marker.fields).toEqual({ len: '27', start: '12' });
		expect(marker.error).toBeNull();
	});

	test('field order does not matter, which is the whole reason for named fields', () => {
		const [a] = findMarkers('@demo[x, len=27, start=12]');
		const [b] = findMarkers('@demo[x, start=12, len=27]');
		expect(a.fields).toEqual(b.fields);
	});

	test('a field added later does not change what an existing marker means', () => {
		const [old] = findMarkers('@demo[x, len=27, start=12]');
		const [next] = findMarkers('@demo[x, len=27, start=12, var=3]');
		expect(next.fields.len).toBe(old.fields.len);
		expect(next.fields.start).toBe(old.fields.start);
		expect(next.fields.var).toBe('3');
	});

	test('framework id, subject key and field names are lowercased', () => {
		const [marker] = findMarkers('@DEMO[Rowan, LEN=27]');
		expect(marker.frameworkId).toBe('demo');
		expect(marker.key).toBe('rowan');
		expect(marker.fields).toEqual({ len: '27' });
	});

	test('whitespace around the key and around each field is not part of it', () => {
		const [marker] = findMarkers('@demo[  rowan ,  len = 27  ]');
		expect(marker.key).toBe('rowan');
		expect(marker.fields).toEqual({ len: '27' });
	});

	test('a value may contain spaces and further equals signs', () => {
		const [marker] = findMarkers('@demo[x, note=due on day 4, eq=a=b]');
		expect(marker.fields).toEqual({ note: 'due on day 4', eq: 'a=b' });
	});

	test('the whole marker and its offset come back, for a single-pass rebuild', () => {
		const [marker] = findMarkers('ab @demo[x] cd');
		expect(marker.raw).toBe('@demo[x]');
		expect(marker.index).toBe(3);
	});

	test('several markers come back in the order they appear', () => {
		const found = findMarkers('@demo[a] then @other[b]');
		expect(found.map((m) => `${m.frameworkId}:${m.key}`)).toEqual(['demo:a', 'other:b']);
	});

	test('the sigil alone is not a marker, so prose survives it', () => {
		expect(findMarkers('email @demo or @demo.')).toEqual([]);
		expect(hasMarker('email @demo or @demo.')).toBe(false);
	});

	test('a marker never spans a newline, so an unclosed bracket cannot eat the entry', () => {
		expect(findMarkers('@demo[x\nshe is 24 years old]')).toEqual([]);
	});

	test('hasMarker answers the same on repeated calls', () => {
		const text = '@demo[x]';
		expect(hasMarker(text)).toBe(true);
		expect(hasMarker(text)).toBe(true);
	});

	describe('malformed markers are rejected by name, never guessed at', () => {
		const cases: [string, string][] = [
			['@demo[]', 'no subject key'],
			['@demo[  ]', 'no subject key'],
			['@demo[-bad]', 'invalid subject key "-bad"'],
			['@demo[x, len]', 'field "len" is not name=value'],
			['@demo[x, =27]', 'field "=27" is not name=value'],
			['@demo[x, len=27,]', 'empty field'],
			['@demo[x, len=27, len=28]', 'duplicate field "len"']
		];
		for (const [text, reason] of cases) {
			test(text, () => {
				const [marker] = findMarkers(text);
				expect(marker.error).toBe(reason);
				expect(marker.key).toBeNull();
			});
		}
	});
});

describe('the dispatcher', () => {
	test('text with no marker comes back untouched, with no records', () => {
		const out = applyFrameworks('just a description', ctx());
		expect(out.text).toBe('just a description');
		expect(out.records).toEqual([]);
	});

	test('a claimed marker is replaced by what its framework computed', () => {
		const out = applyFrameworks('Status: @demo[rowan]', ctx());
		expect(out.text).toBe('Status: <rowan>');
		expect(out.records[0]).toMatchObject({ status: 'rendered', key: 'rowan', text: '<rowan>' });
	});

	test('the framework is handed the key, the fields, the day and its own state slice', () => {
		let seen: FrameworkComputeInput | null = null;
		applyFrameworks(
			'@demo[rowan, len=27]',
			ctx({
				frameworks: [
					fake((input) => {
						seen = input;
						return 'x';
					})
				],
				day: 63,
				byFramework: { demo: { note: 'mine' }, other: { note: 'not mine' } }
			})
		);
		expect(seen).toEqual({
			key: 'rowan',
			fields: { len: '27' },
			day: 63,
			state: { note: 'mine' }
		});
	});

	describe('an unconsumed marker is REMOVED, never passed through', () => {
		const strips: [string, FrameworkContext, string][] = [
			['unknownFramework', ctx({ frameworks: [] }), 'unknownFramework'],
			['disabled', ctx({ disabled: ['demo'] }), 'disabled'],
			['suppressed', ctx({ suppressed: ['rowan'] }), 'suppressed'],
			['noOutput (null)', ctx({ frameworks: [fake(() => null)] }), 'noOutput'],
			['noOutput (blank)', ctx({ frameworks: [fake(() => '   ')] }), 'noOutput']
		];
		for (const [name, context, status] of strips) {
			test(name, () => {
				const out = applyFrameworks('Status: @demo[rowan]', context);
				expect(out.text).toBe('Status:');
				expect(out.records[0]).toMatchObject({ status, raw: '@demo[rowan]' });
			});
		}

		test('malformed, and the record says why', () => {
			const out = applyFrameworks('Status: @demo[x, len]', ctx());
			expect(out.text).toBe('Status:');
			expect(out.records[0]).toMatchObject({
				status: 'malformed',
				reason: 'field "len" is not name=value'
			});
		});
	});

	test('a switched-off framework reads as disabled, not as a misspelling', () => {
		const out = applyFrameworks('@demo[x]', ctx({ disabled: ['demo'] }));
		expect(out.records[0].status).toBe('disabled');
	});

	test('a marker alone on its line takes the whole line with it', () => {
		const out = applyFrameworks('Alice\n@demo[x]\nBob', ctx({ frameworks: [] }));
		expect(out.text).toBe('Alice\nBob');
	});

	test('a marker sharing its line leaves the author’s own words behind', () => {
		const out = applyFrameworks('Alice\nCycle: @demo[x]\nBob', ctx({ frameworks: [] }));
		expect(out.text).toBe('Alice\nCycle:\nBob');
	});

	test('a rendered marker keeps its line even when nothing else is on it', () => {
		const out = applyFrameworks('Alice\n@demo[x]\nBob', ctx());
		expect(out.text).toBe('Alice\n<x>\nBob');
	});

	test('several markers on one line are rebuilt in a single pass', () => {
		const out = applyFrameworks('@demo[a] and @demo[b]', ctx());
		expect(out.text).toBe('<a> and <b>');
		expect(out.records).toHaveLength(2);
	});

	test('one entry may carry a marker per character', () => {
		const out = applyFrameworks('Alice\n@demo[alice]\n\nBeth\n@demo[beth]', ctx());
		expect(out.text).toBe('Alice\n<alice>\n\nBeth\n<beth>');
		expect(out.records.map((r) => r.key)).toEqual(['alice', 'beth']);
	});

	test('a stripped marker and a rendered one can share a line', () => {
		const out = applyFrameworks('@demo[a] / @nobody[b]', ctx());
		expect(out.text).toBe('<a> /');
		expect(out.records.map((r) => r.status)).toEqual(['rendered', 'unknownFramework']);
	});

	test('the same input twice gives the same answer, which the meter and the send rely on', () => {
		const text = 'Status: @demo[rowan, len=27]';
		expect(applyFrameworks(text, ctx()).text).toBe(applyFrameworks(text, ctx()).text);
	});
});
