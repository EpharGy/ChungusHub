/**
 * Tests for the regex-rules engine. Run with `bun test`.
 *
 * Locks the behaviors the feature promises: normalization keeps a deleted
 * default deleted, application respects order/targets/scopes and skips invalid
 * patterns instead of throwing, the prompt transform is non-destructive and
 * allocation-shy, imports understand both our envelope and SillyTavern regex
 * scripts, and the shipped em-dash rule doesn't mangle dialogue dashes.
 */

import { describe, expect, test } from 'bun:test';

import {
	applyPromptRegex,
	applyRegexRules,
	createRegexRule,
	DEFAULT_REGEX_RULES,
	depthInverted,
	depthSentence,
	isRuleInert,
	normalizeCarriedRules,
	normalizeRegexRules,
	normalizeRuleFlags,
	parseRegexRulesImport,
	regexRuleError,
	routingSentence,
	rulesWithCarried,
	serializeRegexRules,
	type RegexRule
} from './regex-rules';

function rule(over: Partial<RegexRule> = {}): RegexRule {
	return createRegexRule({ pattern: 'foo', replacement: 'bar', targets: ['user', 'assistant'], ...over });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function msg(id: string, role: string, content: string): any {
	return { id, role, content, parentId: null };
}

describe('normalizeRegexRules', () => {
	test('missing blob seeds the full starter pack, every rule disabled', () => {
		const rules = normalizeRegexRules(null);
		expect(rules).toHaveLength(DEFAULT_REGEX_RULES.length);
		expect(rules.every((r) => r.enabled === false)).toBe(true);
		expect(rules.some((r) => r.id === 'default-em-dash')).toBe(true);
	});

	test('seeded defaults are copies: mutating them leaves the source intact', () => {
		const rules = normalizeRegexRules(undefined);
		const emDash = rules.find((r) => r.id === 'default-em-dash')!;
		emDash.enabled = true;
		emDash.targets.push('user');
		const source = DEFAULT_REGEX_RULES.find((r) => r.id === 'default-em-dash')!;
		expect(source.enabled).toBe(false);
		expect(source.targets).toEqual(['assistant']);
	});

	test('an empty stored array stays empty: deleting the default sticks', () => {
		expect(normalizeRegexRules([])).toEqual([]);
	});

	test('malformed entries are dropped, valid ones survive', () => {
		const rules = normalizeRegexRules([
			{ pattern: 'ok', replacement: 'x' },
			{ replacement: 'no pattern' },
			'garbage',
			null
		]);
		expect(rules).toHaveLength(1);
		expect(rules[0].pattern).toBe('ok');
	});

	test('a half-written rule with an empty pattern survives normalization', () => {
		const rules = normalizeRegexRules([{ pattern: '', name: 'Draft' }]);
		expect(rules).toHaveLength(1);
		expect(rules[0].name).toBe('Draft');
	});

	test('unknown flags are stripped, unknown targets/scopes filtered, missing ones default to all', () => {
		const [r] = normalizeRegexRules([
			{ pattern: 'a', flags: 'zgxi', targets: ['assistant', 'narrator'], scopes: undefined }
		]);
		expect(r.flags).toBe('gi');
		expect(r.targets).toEqual(['assistant']);
		expect(r.scopes).toEqual(['display', 'prompt']);
	});
});

describe('normalizeRuleFlags', () => {
	test('filters to the allowed set in canonical order', () => {
		expect(normalizeRuleFlags('sugiy')).toBe('gisu');
		expect(normalizeRuleFlags('')).toBe('');
	});
});

describe('regexRuleError', () => {
	test('valid pattern reports null', () => {
		expect(regexRuleError({ pattern: 'a+', flags: 'g' })).toBeNull();
	});

	test('invalid pattern and empty pattern report a message', () => {
		expect(regexRuleError({ pattern: '(', flags: 'g' })).toBeTruthy();
		expect(regexRuleError({ pattern: '', flags: 'g' })).toBeTruthy();
	});
});

describe('routingSentence', () => {
	test('names both halves', () => {
		expect(routingSentence({ targets: ['user', 'assistant'], scopes: ['display', 'prompt'] })).toBe(
			'Applies to your messages & AI replies · rewrites chat display & outgoing prompt'
		);
	});

	test('a single target and scope read in the singular', () => {
		expect(routingSentence({ targets: ['assistant'], scopes: ['prompt'] })).toBe(
			'Applies to AI replies · rewrites outgoing prompt'
		);
	});

	test('an empty half never leaves a blank in the sentence', () => {
		const inert = 'Applies to nothing: pick who it touches and where it rewrites.';
		expect(routingSentence({ targets: [], scopes: ['display'] })).toBe(inert);
		expect(routingSentence({ targets: ['user'], scopes: [] })).toBe(inert);
		expect(isRuleInert({ targets: [], scopes: [] })).toBe(true);
		expect(isRuleInert({ targets: ['user'], scopes: ['display'] })).toBe(false);
	});
});

describe('applyRegexRules', () => {
	test('replaces with capture groups and applies rules in list order', () => {
		const first = rule({ pattern: '(\\w+)@example\\.com', replacement: '$1@masked' });
		const second = rule({ pattern: 'masked', replacement: 'hidden' });
		const out = applyRegexRules('mail bob@example.com now', [first, second], 'user', 'display', 0);
		expect(out).toBe('mail bob@hidden now');
	});

	test('respects role targets and scopes', () => {
		const r = rule({ targets: ['assistant'], scopes: ['display'] });
		expect(applyRegexRules('foo', [r], 'user', 'display', 0)).toBe('foo');
		expect(applyRegexRules('foo', [r], 'assistant', 'prompt', 0)).toBe('foo');
		expect(applyRegexRules('foo', [r], 'assistant', 'display', 0)).toBe('bar');
	});

	test('system messages are never touched', () => {
		expect(applyRegexRules('foo', [rule()], 'system', 'display', 0)).toBe('foo');
	});

	test('disabled, invalid and empty-pattern rules are skipped without throwing', () => {
		const off = rule({ enabled: false });
		const broken = rule({ pattern: '(' });
		const empty = rule({ pattern: '', replacement: ', ' });
		expect(applyRegexRules('foo', [off, broken, empty], 'user', 'display', 0)).toBe('foo');
	});

	test('without the g flag only the first occurrence is replaced', () => {
		const once = rule({ pattern: 'foo', flags: '' });
		expect(applyRegexRules('foo foo', [once], 'user', 'display', 0)).toBe('bar foo');
	});
});

describe('depth bounds', () => {
	const at = (depth: number, over: Partial<RegexRule>) =>
		applyRegexRules('foo', [rule(over)], 'user', 'display', depth);

	test('no bounds reach every turn', () => {
		expect(at(0, {})).toBe('bar');
		expect(at(99, {})).toBe('bar');
	});

	test('minDepth skips the turns nearer than it', () => {
		expect(at(0, { minDepth: 2 })).toBe('foo');
		expect(at(1, { minDepth: 2 })).toBe('foo');
		expect(at(2, { minDepth: 2 })).toBe('bar');
		expect(at(9, { minDepth: 2 })).toBe('bar');
	});

	test('maxDepth stops once the turns get older than it', () => {
		expect(at(0, { maxDepth: 1 })).toBe('bar');
		expect(at(1, { maxDepth: 1 })).toBe('bar');
		expect(at(2, { maxDepth: 1 })).toBe('foo');
	});

	test('both ends are inclusive', () => {
		const window = { minDepth: 1, maxDepth: 3 };
		expect([0, 1, 2, 3, 4].map((d) => at(d, window))).toEqual(['foo', 'bar', 'bar', 'bar', 'foo']);
	});

	// The whole point of the feature: the newest reply keeps its state block, every turn
	// behind it goes out without one.
	test('applyPromptRegex measures depth from the end of the array', () => {
		const chat = [msg('m1', 'assistant', 'foo'), msg('m2', 'assistant', 'foo'), msg('m3', 'assistant', 'foo')];
		const out = applyPromptRegex(chat, [rule({ scopes: ['prompt'], minDepth: 1 })]);
		expect(out.map((m) => m.content)).toEqual(['bar', 'bar', 'foo']);
	});

	test('an inverted range is inert and says so', () => {
		const inverted = rule({ minDepth: 4, maxDepth: 2 });
		expect(at(3, { minDepth: 4, maxDepth: 2 })).toBe('foo');
		expect(depthInverted(inverted)).toBe(true);
		expect(isRuleInert(inverted)).toBe(true);
		expect(depthSentence(inverted)).toBe('reaches no turn at all');
		expect(routingSentence(inverted)).toBe(
			'Applies to nothing: it starts further back than it reaches.'
		);
	});

	test('a bound that is not a whole turn count reads as no bound, never as 0', () => {
		const [imported] = normalizeRegexRules([
			{ pattern: 'x', minDepth: null, maxDepth: -3 },
			{ pattern: 'y', minDepth: 2.5 }
		]);
		expect(imported.minDepth).toBeUndefined();
		expect(imported.maxDepth).toBeUndefined();
		expect(normalizeRegexRules([{ pattern: 'y', minDepth: 2.5 }])[0].minDepth).toBeUndefined();
	});

	test('the reach sentence counts whole turns, not raw depths', () => {
		expect(depthSentence({ targets: [], scopes: [], minDepth: undefined, maxDepth: undefined })).toBeNull();
		expect(depthSentence({ targets: [], scopes: [], minDepth: 0 })).toBeNull();
		expect(depthSentence({ targets: [], scopes: [], minDepth: 1 })).toBe('skips the newest turn');
		expect(depthSentence({ targets: [], scopes: [], minDepth: 3 })).toBe('skips the newest 3 turns');
		expect(depthSentence({ targets: [], scopes: [], maxDepth: 0 })).toBe('only the newest turn');
		expect(depthSentence({ targets: [], scopes: [], maxDepth: 2 })).toBe('only the newest 3 turns');
		expect(depthSentence({ targets: [], scopes: [], minDepth: 2, maxDepth: 5 })).toBe('only turns 2 to 5 back');
	});

	test('routingSentence carries the reach onto every list that shows a rule', () => {
		expect(routingSentence({ targets: ['assistant'], scopes: ['prompt'], minDepth: 1 })).toBe(
			'Applies to AI replies · rewrites outgoing prompt · skips the newest turn'
		);
	});
});

describe('applyPromptRegex', () => {
	const CHAT = [msg('m1', 'user', 'foo user'), msg('m2', 'assistant', 'foo reply')];

	test('returns the same array when no rule can apply', () => {
		expect(applyPromptRegex(CHAT, undefined)).toBe(CHAT);
		expect(applyPromptRegex(CHAT, [])).toBe(CHAT);
		expect(applyPromptRegex(CHAT, [rule({ enabled: false })])).toBe(CHAT);
		expect(applyPromptRegex(CHAT, [rule({ scopes: ['display'] })])).toBe(CHAT);
		expect(applyPromptRegex(CHAT, [rule({ targets: [] })])).toBe(CHAT);
	});

	test('maps only targeted contents and reuses untouched message objects', () => {
		const out = applyPromptRegex(CHAT, [rule({ targets: ['assistant'], scopes: ['prompt'] })]);
		expect(out).not.toBe(CHAT);
		expect(out[0]).toBe(CHAT[0]);
		expect(out[1].content).toBe('bar reply');
		expect(out[1].id).toBe('m2');
		expect(CHAT[1].content).toBe('foo reply');
	});
});

/** A starter-pack rule by id, force-enabled for behavior testing. */
function defaultRule(id: string): RegexRule {
	const source = DEFAULT_REGEX_RULES.find((r) => r.id === id);
	if (!source) throw new Error(`no default rule ${id}`);
	return { ...source, enabled: true, targets: [...source.targets], scopes: [...source.scopes] };
}

describe('default em-dash rule', () => {
	const emDash = defaultRule('default-em-dash');
	const apply = (text: string) => applyRegexRules(text, [emDash], 'assistant', 'display', 0);

	test('ships disabled and targets AI output in both scopes', () => {
		const source = DEFAULT_REGEX_RULES.find((r) => r.id === 'default-em-dash')!;
		expect(source.enabled).toBe(false);
		expect(source.targets).toEqual(['assistant']);
		expect(source.scopes).toEqual(['display', 'prompt']);
	});

	test('replaces parenthetical em dashes, spaced or tight, including runs', () => {
		expect(apply('The night was cold—almost freezing—and dark.')).toBe( // em-dash: data
			'The night was cold, almost freezing, and dark.'
		);
		expect(apply('He paused — then spoke.')).toBe('He paused, then spoke.'); // em-dash: data
		expect(apply('a——b')).toBe('a, b'); // em-dash: data
		expect(apply('It was 1999—2001 all over.')).toBe('It was 1999, 2001 all over.'); // em-dash: data
	});

	test('works between non-ASCII letters', () => {
		expect(apply('Kapı açıldı—içeri girdi.')).toBe('Kapı açıldı, içeri girdi.'); // em-dash: data
	});

	test('leaves interrupted speech and dialogue dashes alone', () => {
		expect(apply('"Don\'t you dare—"')).toBe('"Don\'t you dare—"'); // em-dash: data
		expect(apply('"—You wouldn\'t."')).toBe('"—You wouldn\'t."'); // em-dash: data
		expect(apply('The line ends.\n— Hello there.')).toBe('The line ends.\n— Hello there.'); // em-dash: data
		expect(apply('She trailed off—')).toBe('She trailed off—'); // em-dash: data
	});
});

describe('default starter-pack rules', () => {
	const apply = (id: string, text: string) =>
		applyRegexRules(text, [defaultRule(id)], 'assistant', 'display', 0);

	test('every rule ships disabled', () => {
		expect(DEFAULT_REGEX_RULES.every((r) => r.enabled === false)).toBe(true);
	});

	test('invisible characters are stripped, visible text untouched', () => {
		expect(apply('default-invisible-chars', 'wo\u200Brd\u200D and\uFEFF more\u2060')).toBe('word and more');
		expect(apply('default-invisible-chars', 'plain text')).toBe('plain text');
	});

	test('non-breaking spaces become plain spaces', () => {
		expect(apply('default-nbsp', 'a\u00A0b\u202Fc')).toBe('a b c');
	});

	test('ellipsis runs settle to three dots, exactly three pass through', () => {
		expect(apply('default-ellipsis', 'Well… maybe')).toBe('Well... maybe');
		expect(apply('default-ellipsis', 'What……')).toBe('What...');
		expect(apply('default-ellipsis', 'So….. yeah')).toBe('So... yeah');
		expect(apply('default-ellipsis', 'Hold on.....')).toBe('Hold on...');
		expect(apply('default-ellipsis', 'Wait... here')).toBe('Wait... here');
		expect(apply('default-ellipsis', 'v1.2 costs 3.14')).toBe('v1.2 costs 3.14');
	});

	test('extra blank lines collapse to one, ghost whitespace lines included', () => {
		expect(apply('default-blank-lines', 'One.\n\n\n\nTwo.')).toBe('One.\n\nTwo.');
		expect(apply('default-blank-lines', 'One.\r\n\r\n\r\nTwo.')).toBe('One.\n\nTwo.');
		expect(apply('default-blank-lines', 'One.\n  \n\t\nTwo.')).toBe('One.\n\nTwo.');
		expect(apply('default-blank-lines', 'One.\n\nTwo.')).toBe('One.\n\nTwo.');
	});

	test('curly quotes straighten; guillemets are spared', () => {
		expect(apply('default-curly-double-quotes', '“Run,” she said. „Ja.”')).toBe(
			'"Run," she said. "Ja."'
		);
		expect(apply('default-curly-double-quotes', '«Bonjour» stays')).toBe('«Bonjour» stays');
		expect(apply('default-curly-single-quotes', 'don’t ‘quote’ me')).toBe("don't 'quote' me");
	});
});

describe('import / export', () => {
	test('round-trips our envelope with fresh ids', () => {
		const source = [rule({ name: 'Mask emails', pattern: 'x', enabled: false })];
		const imported = parseRegexRulesImport(serializeRegexRules(source));
		expect(imported).toHaveLength(1);
		expect(imported[0].name).toBe('Mask emails');
		expect(imported[0].enabled).toBe(false);
		expect(imported[0].id).not.toBe(source[0].id);
	});

	test('accepts a bare rule array and a single rule object', () => {
		expect(parseRegexRulesImport('[{"pattern":"a"},{"pattern":"b"}]')).toHaveLength(2);
		expect(parseRegexRulesImport('{"pattern":"a","replacement":"b"}')).toHaveLength(1);
	});

	test('converts a SillyTavern regex script', () => {
		const st = JSON.stringify({
			scriptName: 'Fix ellipsis',
			findRegex: '/\\.{3,}/g',
			replaceString: '{{match}}!',
			placement: [1],
			markdownOnly: true,
			disabled: true
		});
		const [r] = parseRegexRulesImport(st);
		expect(r.name).toBe('Fix ellipsis');
		expect(r.pattern).toBe('\\.{3,}');
		expect(r.flags).toBe('g');
		expect(r.replacement).toBe('$&!');
		expect(r.targets).toEqual(['user']);
		expect(r.scopes).toEqual(['display']);
		expect(r.enabled).toBe(false);
	});

	test('SillyTavern defaults: bare find string compiles flagless, missing placement means AI output, no ephemerality flags mean both scopes', () => {
		const [r] = parseRegexRulesImport(JSON.stringify({ scriptName: 's', findRegex: 'plain' }));
		expect(r.pattern).toBe('plain');
		expect(r.flags).toBe('');
		expect(r.targets).toEqual(['assistant']);
		expect(r.scopes).toEqual(['display', 'prompt']);
		expect(r.enabled).toBe(true);
		expect(r.minDepth).toBeUndefined();
		expect(r.maxDepth).toBeUndefined();
	});

	// Both formats count turns back from the newest, so the numbers cross unchanged; ST's
	// `null` for "no bound" must not land as 0, which would mean the newest turn only.
	test('SillyTavern depth bounds carry across, null included', () => {
		const [r] = parseRegexRulesImport(
			JSON.stringify({ scriptName: 's', findRegex: 'x', minDepth: 2, maxDepth: null })
		);
		expect(r.minDepth).toBe(2);
		expect(r.maxDepth).toBeUndefined();
	});

	test('throws loudly on garbage', () => {
		expect(() => parseRegexRulesImport('not json')).toThrow('Not valid JSON');
		expect(() => parseRegexRulesImport('{"hello":"world"}')).toThrow('No regex rules');
		expect(() => parseRegexRulesImport('[]')).toThrow('No regex rules');
	});
});

describe('normalizeCarriedRules', () => {
	test('keeps a declared id: the reader\'s switch is stored against it', () => {
		const rules = normalizeCarriedRules([{ id: 'panel-skin', pattern: '<details>' }])!;
		expect(rules[0].id).toBe('panel-skin');
	});

	test('keeps the id a SillyTavern script declares', () => {
		const rules = normalizeCarriedRules([{ id: 'st-1', scriptName: 'Panels', findRegex: '/x/g' }])!;
		expect(rules[0].id).toBe('st-1');
		expect(rules[0].name).toBe('Panels');
	});

	test('mints a fresh UNIQUE id per entry that declares none', () => {
		const rules = normalizeCarriedRules([{ pattern: 'a' }, { pattern: 'b' }])!;
		expect(rules[0].id).toBeTruthy();
		expect(rules[1].id).toBeTruthy();
		// Positional ids would collide across two id-less presets, and the override map is
		// one flat map keyed by rule id.
		expect(rules[0].id).not.toBe(rules[1].id);
	});

	test('undefined for a non-array and for a list nothing survives', () => {
		expect(normalizeCarriedRules(undefined)).toBeUndefined();
		expect(normalizeCarriedRules({ pattern: 'a' })).toBeUndefined();
		expect(normalizeCarriedRules([])).toBeUndefined();
		expect(normalizeCarriedRules(['garbage', null])).toBeUndefined();
	});
});

describe('rulesWithCarried', () => {
	const mine = [rule({ name: 'Mine', pattern: 'm' })];
	const carried = [
		rule({ id: 'c-on', name: 'Shipped on', pattern: 'a', enabled: true }),
		rule({ id: 'c-off', name: 'Shipped off', pattern: 'b', enabled: false })
	];

	test('the reader\'s rules run first, the preset\'s after', () => {
		const out = rulesWithCarried(mine, carried);
		expect(out.map((r) => r.name)).toEqual(['Mine', 'Shipped on', 'Shipped off']);
	});

	test('returns the same array when the preset carries nothing', () => {
		expect(rulesWithCarried(mine, undefined)).toBe(mine);
		expect(rulesWithCarried(mine, [])).toBe(mine);
	});

	test('an absent override follows the author, both ways', () => {
		const out = rulesWithCarried(mine, carried, {});
		expect(out[1].enabled).toBe(true);
		expect(out[2].enabled).toBe(false);
	});

	test('an override flips the effective state in both directions', () => {
		const out = rulesWithCarried(mine, carried, { 'c-on': false, 'c-off': true });
		expect(out[1].enabled).toBe(false);
		expect(out[2].enabled).toBe(true);
	});

	test('an override that agrees with the author reuses the rule object', () => {
		const out = rulesWithCarried(mine, carried, { 'c-on': true });
		expect(out[1]).toBe(carried[0]);
		expect(out[2]).toBe(carried[1]);
	});

	test('a non-boolean stored value is ignored rather than coerced', () => {
		const out = rulesWithCarried(mine, carried, { 'c-off': 'yes' } as unknown as Record<string, boolean>);
		expect(out[2].enabled).toBe(false);
	});

	test('a rule id that names an inherited property is not an override', () => {
		// Rule ids arrive inside a downloaded preset, and "constructor" is a legal string.
		const named = [rule({ id: 'constructor', pattern: 'c', enabled: false })];
		expect(rulesWithCarried(mine, named, {})[1].enabled).toBe(false);
	});

	test('never mutates the inputs', () => {
		rulesWithCarried(mine, carried, { 'c-off': true });
		expect(carried[1].enabled).toBe(false);
		expect(mine).toHaveLength(1);
	});
});

describe('a carried rule the author shipped off', () => {
	// The whole point of the override map: an author can ship an optional flourish switched
	// off and the reader can actually turn it on, and turning the author's own on-by-default
	// rule off actually stops it.
	const optional = rule({ id: 'flourish', pattern: 'foo', replacement: 'bar', enabled: false });
	const shipped = rule({ id: 'always', pattern: 'baz', replacement: 'qux', enabled: true });
	const run = (overrides: Record<string, boolean>) =>
		applyRegexRules('foo baz', rulesWithCarried([], [optional, shipped], overrides), 'user', 'display', 0);

	test('stays off until the reader turns it on, and then rewrites', () => {
		expect(run({})).toBe('foo qux');
		expect(run({ flourish: true })).toBe('bar qux');
	});

	test('a shipped-on rule stops when the reader switches it off', () => {
		expect(run({ always: false })).toBe('foo baz');
	});
});
