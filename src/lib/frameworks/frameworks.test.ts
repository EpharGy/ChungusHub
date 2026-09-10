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

import {
	defaultChatFrameworkState,
	MAX_FRAMEWORK_SLICES,
	MAX_STORY_DAY,
	MAX_SUPPRESSED,
	normalizeChatFrameworkState,
	parseDayArg
} from './chat-state';
import { createEmptyLorebook, createEmptyLorebookEntry } from '$lib/lorebook/types';
import { resolveLorebooks } from '$lib/lorebook/engine';

import { frameworkDecorator } from './apply';
import { resolveDay, todaySerial, type DayMode } from './day';
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

	test('a subject key is a NAME, so it may contain spaces', () => {
		// The rule was a slug once, which rejected this and, because a malformed marker is
		// stripped, took the line out of the prompt with nothing on screen to say why.
		const [marker] = findMarkers('@season[Ada Lovelace, len=90, start=14]');
		expect(marker.error).toBeNull();
		expect(marker.key).toBe('ada lovelace');
		expect(marker.fields).toEqual({ len: '90', start: '14' });
	});

	test('names outside the Latin alphabet work too', () => {
		expect(findMarkers('@demo[山田花子]')[0].key).toBe('山田花子');
		expect(findMarkers('@demo[Ayşe Yılmaz]')[0].error).toBeNull();
	});

	test('the punctuation real names carry is allowed', () => {
		for (const name of ["O'Brien", 'St. John', 'Anne-Marie', 'Ni_no']) {
			expect(findMarkers(`@demo[${name}]`)[0].error).toBeNull();
		}
	});

	test('the author’s own spelling is kept beside the folded key', () => {
		// The folded key decides identity; this is what a framework prints. A status line read
		// outside the entry it came from has nothing else to say who it is about.
		const [marker] = findMarkers('@season[Ada Lovelace, len=90]');
		expect(marker.key).toBe('ada lovelace');
		expect(marker.subject).toBe('Ada Lovelace');
	});

	test('one subject written two ways folds to one key', () => {
		const key = (text: string) => findMarkers(text)[0].key;
		expect(key('@demo[Ada Lovelace]')).toBe(key('@demo[ada  lovelace]'));
		expect(key('@demo[  Ada Lovelace  ]')).toBe('ada lovelace');
	});

	test('a field NAME stays strict, because that vocabulary is not a person', () => {
		expect(findMarkers('@demo[x, cycle len=27]')[0].error).toBe('invalid field name "cycle len"');
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
			subject: 'rowan',
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

describe('the per-chat blob', () => {
	// The only thing frameworks store. Everything a framework knows about a CHARACTER lives
	// in that character's lorebook entry, so what is here is the handful of facts that are
	// true of one story and could not sit in a shared entry.

	test('a chat that predates the feature reads as day 1 with nothing suppressed', () => {
		expect(normalizeChatFrameworkState(undefined)).toEqual(defaultChatFrameworkState());
		expect(normalizeChatFrameworkState(null)).toEqual(defaultChatFrameworkState());
		expect(normalizeChatFrameworkState('nonsense')).toEqual(defaultChatFrameworkState());
		expect(normalizeChatFrameworkState([])).toEqual(defaultChatFrameworkState());
	});

	test('a stored blob comes back as it went in', () => {
		const stored = { enabled: ['demo'], mode: 'marker', day: 63, suppressed: ['rowan'], byFramework: { demo: { note: 'x' } } };
		expect(normalizeChatFrameworkState(stored)).toEqual(stored);
	});

	describe('the day', () => {
		test('a missing or unusable day is day 1, never NaN', () => {
			for (const raw of [undefined, 'twelve', null, Number.NaN, Infinity]) {
				expect(normalizeChatFrameworkState({ day: raw }).day).toBe(1);
			}
		});

		test('is an integer, so a fractional day cannot land mid-cycle', () => {
			expect(normalizeChatFrameworkState({ day: 12.7 }).day).toBe(12);
		});

		test('may be negative, because a story may number its days from anywhere', () => {
			expect(normalizeChatFrameworkState({ day: -5 }).day).toBe(-5);
		});

		test('is clamped, because a blob that arrived oversized must not be re-saved that way', () => {
			expect(normalizeChatFrameworkState({ day: 1e12 }).day).toBe(MAX_STORY_DAY);
			expect(normalizeChatFrameworkState({ day: -1e12 }).day).toBe(-MAX_STORY_DAY);
		});
	});

	describe('the suppression list', () => {
		test('is lowercased, so it compares directly against a parsed marker key', () => {
			expect(normalizeChatFrameworkState({ suppressed: ['Rowan'] }).suppressed).toEqual(['rowan']);
		});

		test('folds a name exactly as a marker does, or it would never match one', () => {
			// These keys are compared against what a marker parsed to. Fold them differently
			// and suppressing "Ada Lovelace" silently stops suppressing anything.
			expect(normalizeChatFrameworkState({ suppressed: ['Ada  Lovelace'] }).suppressed).toEqual(['ada lovelace']);
		});

		test('is deduped, so one subject cannot be listed twice under two spellings', () => {
			expect(normalizeChatFrameworkState({ suppressed: ['a', 'A', 'a'] }).suppressed).toEqual(['a']);
		});

		test('drops anything that is not a usable key', () => {
			expect(normalizeChatFrameworkState({ suppressed: ['a', '', 3, null, 'b'] }).suppressed).toEqual(['a', 'b']);
		});

		test('is capped', () => {
			const many = Array.from({ length: MAX_SUPPRESSED + 50 }, (_, i) => `k${i}`);
			expect(normalizeChatFrameworkState({ suppressed: many }).suppressed).toHaveLength(MAX_SUPPRESSED);
		});
	});

	describe('the per-framework slices', () => {
		test('a slice rides through untouched, because the base never reads inside one', () => {
			const slice = { anchors: { rowan: 63 }, anything: [1, 2, 3] };
			expect(normalizeChatFrameworkState({ byFramework: { demo: slice } }).byFramework.demo).toEqual(slice);
		});

		test('a value no framework could have written is dropped', () => {
			const out = normalizeChatFrameworkState({
				byFramework: { a: 'text', b: 7, c: null, d: [1], e: {} }
			});
			expect(Object.keys(out.byFramework)).toEqual(['e']);
		});

		test('ids are lowercased to match the framework ids markers parse to', () => {
			const out = normalizeChatFrameworkState({ byFramework: { DEMO: { x: 1 } } });
			expect(Object.keys(out.byFramework)).toEqual(['demo']);
		});

		test('is capped', () => {
			const many = Object.fromEntries(
				Array.from({ length: MAX_FRAMEWORK_SLICES + 10 }, (_, i) => [`f${i}`, { x: 1 }])
			);
			expect(Object.keys(normalizeChatFrameworkState({ byFramework: many }).byFramework)).toHaveLength(
				MAX_FRAMEWORK_SLICES
			);
		});
	});
});

describe('the /day argument', () => {
	test('a bare number sets the day', () => {
		expect(parseDayArg('42', 1)).toBe(42);
		expect(parseDayArg('  42  ', 1)).toBe(42);
	});

	test('a signed number steps from the day the story is on', () => {
		expect(parseDayArg('+1', 41)).toBe(42);
		expect(parseDayArg('+7', 1)).toBe(8);
		expect(parseDayArg('-1', 42)).toBe(41);
	});

	test('a leading minus always steps back, and never sets a negative day', () => {
		// The ambiguity is real and it is settled in favour of the reading the sign has
		// everywhere else. Rewinding a day is common; numbering a story from below zero is not.
		expect(parseDayArg('-5', 100)).toBe(95);
	});

	test('stepping below zero is allowed, because a story may pass its own day one', () => {
		expect(parseDayArg('-5', 2)).toBe(-3);
	});

	test('anything that is not a day is null, so the command can say so', () => {
		for (const arg of ['', 'tomorrow', '4.5', '1 2', '+', '--1', '0x10']) {
			expect(parseDayArg(arg, 1)).toBeNull();
		}
	});

	test('the result is clamped exactly as a stored day is', () => {
		expect(parseDayArg('+1', MAX_STORY_DAY)).toBe(MAX_STORY_DAY);
		expect(parseDayArg('99999999999', 1)).toBe(MAX_STORY_DAY);
	});
});

describe('the decorator the app actually builds', () => {
	// The base's own end-to-end claim, and the reason this branch is provable without a
	// framework existing: with none registered, a marker is recognised, claimed by nobody,
	// and stripped before the prompt goes out.

	function entryText(text: string, state: Parameters<typeof frameworkDecorator>[0]): string {
		const book = createEmptyLorebook('Test');
		book.entries = [{ ...createEmptyLorebookEntry(), content: text, constant: true }];
		return resolveLorebooks({ books: [book], messages: [], decorate: frameworkDecorator(state, []) }).text;
	}

	test('a marker no framework claims never reaches the prompt', () => {
		// Named for a framework that will never exist, deliberately: this asserts the base's
		// own promise rather than the registry happening to be empty, so it stays true on a
		// branch that registers one, and needs no edit when the first framework arrives.
		expect(entryText('Rowan, 24.\n@nosuchframework[rowan, len=27]', defaultChatFrameworkState())).toBe(
			'Rowan, 24.'
		);
	});

	test('the day the framework sees follows the MODE, not just the stored number', () => {
		// day.ts reached the way the app reaches it. A fake framework prints the day it was
		// handed, so this asserts what a real one would compute against.
		const today = todaySerial(new Date(2026, 9, 10));
		const book = createEmptyLorebook('T');
		book.entries = [{ ...createEmptyLorebookEntry(), constant: true, content: '@demo[x]' }];
		const seen = (mode: DayMode) =>
			resolveLorebooks({
				books: [book],
				messages: [],
				decorate: (entry, text) =>
					applyFrameworks(
						text,
						ctx({
							frameworks: [fake(({ day }) => `day ${day}`)],
							day: resolveDay({ mode, manual: 3, today }).day
						})
					).text
			}).text;

		// Manual: the stored number, and no clock is read.
		expect(seen('manual')).toBe('day 3');
		// Real time: today, and the stored number is never reached.
		expect(seen('marker')).toBe(`day ${today}`);
	});

	test('prose around a marker is untouched', () => {
		expect(entryText('Red hair. Brusque.', defaultChatFrameworkState())).toBe('Red hair. Brusque.');
	});

	test('a surface with no story runs no framework at all, rather than assuming day 1', () => {
		// A library meter or the prompt builder pricing a preset holds no chat. It must not
		// invent one, and NO_DECORATION is what that looks like: the text is left exactly as
		// stored, marker included, because nothing has been asked to resolve it.
		expect(entryText('@nosuchframework[rowan]', undefined)).toBe('@nosuchframework[rowan]');
	});
});
