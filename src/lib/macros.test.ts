/**
 * The macros whose output is not a function of the context alone: the clock pair, and the
 * argument macros {{random}} / {{roll}}. Run with `bun test`.
 *
 * The clock macros replicate SillyTavern's, which read the clock at substitution time, so
 * there is no instant to inject and no exact string to pin. What is worth pinning is the
 * SHAPE: a preset written in SillyTavern says "the current real time is {{time}}, {{weekday}}
 * {{date}}" and expects moment's `LT`, `dddd` and `LL` back. A format that drifts from those
 * is what this catches, along with the off-by-one that `Date`'s 0-based months invite.
 *
 * {{random}} and {{roll}} are here for the same reason. The suite leans on one-sided dice
 * (`3d1+4` is always 7) so the arithmetic is pinned exactly, and only the tests that are
 * ABOUT randomness sample repeatedly. Their pruning interaction lives in
 * prompt-pruning.test.ts, with the rest of the pruning rules.
 */

import { describe, expect, test } from 'bun:test';

import { expandMacros, substitute } from './macros';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

describe('date and time macros', () => {
	test("{{time}} prints moment's LT, e.g. 6:02 PM", () => {
		expect(expandMacros('{{time}}', {})).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
	});

	test("{{date}} prints moment's LL, e.g. August 22, 2026", () => {
		const out = expandMacros('{{date}}', {});
		expect(out).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
		expect(MONTHS).toContain(out.split(' ')[0]);
	});

	test("{{weekday}} prints moment's dddd, e.g. Saturday", () => {
		expect(WEEKDAYS).toContain(expandMacros('{{weekday}}', {}));
	});

	test('the ISO pair is fixed-width and not localised', () => {
		// HH:mm, matching SillyTavern. Seconds are deliberately not part of it.
		expect(expandMacros('{{isotime}}', {})).toMatch(/^\d{2}:\d{2}$/);
		expect(expandMacros('{{isodate}}', {})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test('the ISO pair carries real calendar and clock values', () => {
		// `Date` counts months from 0, so a missing +1 prints 2026-00-22 every January and
		// reads as well-formed to the shape check above.
		const [, month, day] = expandMacros('{{isodate}}', {}).split('-').map(Number);
		expect(month).toBeGreaterThanOrEqual(1);
		expect(month).toBeLessThanOrEqual(12);
		expect(day).toBeGreaterThanOrEqual(1);
		expect(day).toBeLessThanOrEqual(31);

		const [hours, minutes] = expandMacros('{{isotime}}', {}).split(':').map(Number);
		expect(hours).toBeLessThanOrEqual(23);
		expect(minutes).toBeLessThanOrEqual(59);
	});

	test('the SillyTavern preset line reads as one string', () => {
		expect(expandMacros('The current real time is {{time}}, {{weekday}} {{date}}', {})).toMatch(
			/^The current real time is \d{1,2}:\d{2} (AM|PM), [A-Z][a-z]+ [A-Z][a-z]+ \d{1,2}, \d{4}$/
		);
	});
});

/** Every result of expanding `template` over `runs` attempts. Randomness is the point of
 *  these macros, so what is asserted is a property of a sample, never of one call. */
function sample(template: string, runs = 40): string[] {
	return Array.from({ length: runs }, () => expandMacros(template, {}));
}

describe('{{roll}}: dice, SillyTavern syntax', () => {
	// One-sided dice make the arithmetic exact: 3d1+4 can only ever be 7.
	test('count, sides and modifier are arithmetic, not approximation', () => {
		expect(expandMacros('{{roll::1d1}}', {})).toBe('1');
		expect(expandMacros('{{roll::3d1+4}}', {})).toBe('7');
		expect(expandMacros('{{roll::5d1-2}}', {})).toBe('3');
	});

	test("droll's optional count: {{roll::d1}} is one die", () => {
		expect(expandMacros('{{roll::d1}}', {})).toBe('1');
	});

	test('a bare number is SillyTavern shorthand for one die of that many sides', () => {
		// {{roll::6}} means 1d6 there, so it must mean 1d6 here.
		expect(expandMacros('{{roll::1}}', {})).toBe('1');
		expect(sample('{{roll::6}}').every((r) => Number(r) >= 1 && Number(r) <= 6)).toBe(true);
	});

	test('all three SillyTavern separators are accepted', () => {
		// `::` is the one ST's own default engine gets wrong: its `[ : ]` class matches a
		// single character, so there `{{roll::1d20}}` captures `:1d20` and silently vanishes.
		expect(expandMacros('{{roll::1d1}}', {})).toBe('1');
		expect(expandMacros('{{roll:1d1}}', {})).toBe('1');
		expect(expandMacros('{{roll 1d1}}', {})).toBe('1');
		expect(expandMacros('{{roll:: 1d1 }}', {})).toBe('1');
	});

	test('the macro name is case-insensitive, as every ST macro regex is', () => {
		expect(expandMacros('{{ROLL::1d1}}', {})).toBe('1');
		expect(expandMacros('{{Roll::1d1}}', {})).toBe('1');
	});

	test('a real roll stays inside its range and is not a constant', () => {
		const runs = sample('{{roll::1d20}}', 60).map(Number);
		expect(runs.every((n) => Number.isInteger(n) && n >= 1 && n <= 20)).toBe(true);
		expect(new Set(runs).size).toBeGreaterThan(1);
	});

	test('a modifier shifts the whole range, including below zero', () => {
		const runs = sample('{{roll::1d4-6}}', 60).map(Number);
		expect(runs.every((n) => n >= -5 && n <= -2)).toBe(true);
	});

	test("formulas outside droll's grammar stay literal instead of vanishing", () => {
		// ST returns '' for each of these and logs to the console. Staying literal is this
		// file's rule for anything unresolvable, so the author sees what they mistyped.
		for (const bad of ['2d6+1d4', '4d6kh3', '0d6', 'banana', '1d', 'd']) {
			expect(expandMacros(`{{roll::${bad}}}`, {})).toBe(`{{roll::${bad}}}`);
		}
	});

	test('the dice-count ceiling holds, and holds at the boundary', () => {
		// droll's own grammar allows 9999999999d6, which is a hang from one typo.
		expect(expandMacros('{{roll::1000d1}}', {})).toBe('1000');
		expect(expandMacros('{{roll::1001d1}}', {})).toBe('{{roll::1001d1}}');
	});

	test('the bare name resolves to nothing, so the lint can flag it', () => {
		expect(expandMacros('{{roll}}', {})).toBe('{{roll}}');
	});
});

describe('{{random}}: list picking, SillyTavern syntax', () => {
	test('an option is chosen from the list and nothing else', () => {
		const runs = sample('{{random::red::green::blue}}', 60);
		expect(runs.every((r) => ['red', 'green', 'blue'].includes(r))).toBe(true);
		expect(new Set(runs).size).toBeGreaterThan(1);
	});

	test('`::` splitting, pinned without randomness', () => {
		expect(expandMacros('{{random::x::x::x}}', {})).toBe('x');
	});

	test("items are trimmed on the `::` path, as ST's newer engine does", () => {
		expect(expandMacros('{{random:: x :: x }}', {})).toBe('x');
	});

	test('a comma list is the fallback when no `::` is present', () => {
		expect(expandMacros('{{random:x,x,x}}', {})).toBe('x');
		expect(expandMacros('{{random: x , x }}', {})).toBe('x');
	});

	test('`::` wins outright over commas, so an option may contain one', () => {
		// ST's rule exactly: the presence of `::` decides, and commas are then literal.
		expect(expandMacros('{{random::a,b::a,b}}', {})).toBe('a,b');
	});

	test('a single leading colon still reaches a `::` list, as in ST', () => {
		// ST's `::?` consumes the one colon here and the rest splits on `::`.
		expect(expandMacros('{{random:x::x::x}}', {})).toBe('x');
	});

	test('an escaped comma is a literal one, not a separator', () => {
		expect(expandMacros('{{random:a\\,b}}', {})).toBe('a,b');
	});

	test('the macro name is case-insensitive', () => {
		expect(expandMacros('{{Random::x::x}}', {})).toBe('x');
		expect(expandMacros('{{RANDOM::x::x}}', {})).toBe('x');
	});

	test('the bare name resolves to nothing, so the lint can flag it', () => {
		expect(expandMacros('{{random}}', {})).toBe('{{random}}');
	});
});

describe('argument macros resolve per occurrence, not per name', () => {
	// This is the whole reason they resolve inside substitute's replace callback. Resolution
	// through `values` is keyed by macro NAME and deduped through a Set, so both occurrences
	// would share one lookup and print the same number every single time.
	test('two rolls in one template roll separately', () => {
		// 1d1000 twice: the halves agree once in 1000 runs, so 40 all-agreeing runs is ~1e-120.
		const runs = sample('{{roll::1d1000}}|{{roll::1d1000}}');
		expect(runs.some((r) => r.split('|')[0] !== r.split('|')[1])).toBe(true);
	});

	test('two identical random lists pick separately', () => {
		const list = '{{random::a::b::c::d::e::f::g::h::i::j::k::l}}';
		const runs = sample(`${list}|${list}`);
		expect(runs.some((r) => r.split('|')[0] !== r.split('|')[1])).toBe(true);
	});
});

describe('argument macros do not escape the single-pass guarantee', () => {
	test('an argument macro arriving inside a VALUE is never rolled', () => {
		// Story text, a lorebook entry or a control's text may contain the literal characters
		// `{{random::a::b}}`. Substitution is one pass precisely so an injected value is not
		// re-scanned as macros; rolling it would be the author's own text being executed.
		expect(substitute('{{x}}', { x: '{{random::a::b}}' })).toBe('{{random::a::b}}');
		expect(substitute('{{x}}', { x: '{{roll::1d20}}' })).toBe('{{roll::1d20}}');
	});

	test('plain macros still resolve alongside argument macros in one pass', () => {
		expect(substitute('{{a}} rolled {{roll::2d1}}', { a: 'Mai' })).toBe('Mai rolled 2');
	});

	test('an unknown plain macro beside an argument macro still stays literal', () => {
		expect(substitute('{{nope}} {{roll::2d1}}', {})).toBe('{{nope}} 2');
	});
});
