/**
 * Chorus: the pure halves. Storage normalization and pruning, which reading the next reply
 * uses, how goals resolve across a branched path, how an agent's answer is read, and where
 * the block lands in an assembled prompt. Run with `bun test`.
 */

import { describe, expect, test } from 'bun:test';

import {
	CHORUS_MAX_MEMBERS,
	CHORUS_MAX_READINGS,
	clearReading,
	makeChorusMember,
	normalizeChorusChatState,
	normalizeChorusReadings,
	putReading,
	type ChorusChatState,
	type ChorusMember,
	type ChorusReading,
	type ChorusReadings
} from './state';
import {
	chorusForPrompt,
	effectiveGoals,
	effectiveStaleLimit,
	isOpening,
	readingFor,
	renderIntentions,
	repliesUntilRead,
	type ChorusPromptSettings
} from './resolve';
import { namedIn, splitByPresence } from './presence';
import { parseChorusAnswer } from './answer';
import { assemblePrompt, type AssembleInput } from '$lib/utils/prompt-assembly';
import { normalizeChatFeatureState } from '$lib/types/chat';
import {
	createEmptyLorebook,
	createEmptyLorebookEntry,
	LOREBOOK_POSITION_AT_DEPTH
} from '$lib/lorebook/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
function msg(id: string, role: string, content = id): any {
	return { id, role, content, parentId: null };
}

function member(id: string, name: string, over: Partial<ChorusMember> = {}): ChorusMember {
	return { ...makeChorusMember(id, name), ...over };
}

function said(memberId: string, name: string, over: Record<string, unknown> = {}): any {
	return {
		memberId,
		name,
		want: `${name} wants something`,
		intends: `${name} does something`,
		goals: { immediate: '', shortTerm: '', longTerm: '' },
		...over
	};
}

function reading(at: number, members: any[]): ChorusReading {
	return { at, members };
}

const NO_GOALS = { immediate: '', shortTerm: '', longTerm: '' };
const NO_PINS = { immediate: false, shortTerm: false, longTerm: false };

const SETTINGS: ChorusPromptSettings = {
	enabled: true,
	wrapper: '[Wants: {{intentions}}]',
	depth: 0,
	role: 'system',
	staleLimit: 1,
	every: 1
};

describe('chorus state', () => {
	test('a blob from before Chorus existed reads as off with nobody on it, and no readings', () => {
		const fs = normalizeChatFeatureState({ steeringHistory: [] });
		expect(fs.chorus).toEqual({ enabled: false, members: [], presentOnly: false, presentDepth: 4 });
		expect(fs.chorusReadings).toEqual({});
	});

	test('the roster round-trips through the feature-state normalizer', () => {
		const state: ChorusChatState = {
			enabled: true,
			members: [member('a', 'Rowan')],
			presentOnly: true,
			presentDepth: 6
		};
		const fs = normalizeChatFeatureState(JSON.stringify({ chorus: state }));
		expect(fs.chorus).toEqual(state);
	});

	test('a member without an id or a name is dropped, and a duplicate id keeps its first entry', () => {
		const state = normalizeChorusChatState({
			enabled: true,
			members: [
				{ id: 'a', name: 'Rowan' },
				{ id: '', name: 'Nobody' },
				{ id: 'b', name: '   ' },
				{ id: 'a', name: 'Rowan again' }
			]
		});
		expect(state.members.map((m) => m.name)).toEqual(['Rowan']);
	});

	test('the roster is capped', () => {
		const members = Array.from({ length: CHORUS_MAX_MEMBERS + 3 }, (_, i) => ({ id: `m${i}`, name: `N${i}` }));
		expect(normalizeChorusChatState({ members }).members).toHaveLength(CHORUS_MAX_MEMBERS);
	});

	test('a member is on unless stored off', () => {
		const state = normalizeChorusChatState({ members: [{ id: 'a', name: 'Rowan' }, { id: 'b', name: 'Tamsin', enabled: false }] });
		expect(state.members.map((m) => m.enabled)).toEqual([true, false]);
	});

	test('a reading with nothing in it is dropped, an error survives on its own', () => {
		const readings = normalizeChorusReadings({
			r1: { at: 1, members: [{ memberId: 'a', want: '', intends: '' }] },
			r2: { at: 2, members: [{ memberId: 'a', error: 'timed out' }] }
		});
		expect(Object.keys(readings)).toEqual(['r2']);
		expect(readings.r2.members[0].error).toBe('timed out');
	});

	test('corrupt readings degrade to none rather than throwing', () => {
		expect(normalizeChorusReadings('nonsense')).toEqual({});
		expect(normalizeChorusReadings([1, 2])).toEqual({});
		expect(normalizeChorusReadings({ r1: 'x' })).toEqual({});
	});

	test('putReading drops readings whose reply no longer exists', () => {
		const before: ChorusReadings = { gone: reading(1, [said('a', 'Rowan')]) };
		const after = putReading(before, 'r2', reading(2, [said('a', 'Rowan')]), ['r2']);
		expect(Object.keys(after)).toEqual(['r2']);
	});

	test('putReading keeps a reading on another branch: unwatched is not stale', () => {
		const before: ChorusReadings = { other: reading(1, [said('a', 'Rowan')]) };
		const after = putReading(before, 'r2', reading(2, [said('a', 'Rowan')]), ['other', 'r2']);
		expect(Object.keys(after).sort()).toEqual(['other', 'r2']);
	});

	test('putReading caps the count, dropping the oldest', () => {
		let readings: ChorusReadings = {};
		const ids = Array.from({ length: CHORUS_MAX_READINGS + 2 }, (_, i) => `r${i}`);
		for (const [i, id] of ids.entries()) readings = putReading(readings, id, reading(i, [said('a', 'Rowan')]), ids);
		expect(Object.keys(readings)).toHaveLength(CHORUS_MAX_READINGS);
		expect(readings.r0).toBeUndefined();
		expect(readings.r1).toBeUndefined();
		expect(readings[ids[ids.length - 1]]).toBeDefined();
	});

	test('clearReading forgets one reply and leaves the rest', () => {
		const readings: ChorusReadings = { r1: reading(1, [said('a', 'Rowan')]), r2: reading(2, [said('a', 'Rowan')]) };
		expect(Object.keys(clearReading(readings, 'r1'))).toEqual(['r2']);
		expect(clearReading(readings, 'missing')).toBe(readings);
	});
});

describe('chorus: which reading the next reply uses', () => {
	const readings: ChorusReadings = { a2: reading(2, [said('x', 'Rowan')]) };

	test("a send's path ends on the user turn; the reply before it is the one read", () => {
		const path = [msg('u1', 'user'), msg('a2', 'assistant'), msg('u3', 'user', '.')];
		expect(readingFor(path, readings, 0)?.messageId).toBe('a2');
	});

	test('an unread newest reply falls back to the one before it within the limit', () => {
		const path = [msg('u1', 'user'), msg('a2', 'assistant'), msg('u3', 'user'), msg('a4', 'assistant'), msg('u5', 'user')];
		expect(readingFor(path, readings, 1)?.messageId).toBe('a2');
		expect(readingFor(path, readings, 0)).toBeNull();
	});

	test('past the limit there is nothing, not something old', () => {
		const path = [
			msg('u1', 'user'),
			msg('a2', 'assistant'),
			msg('a4', 'assistant'),
			msg('a6', 'assistant'),
			msg('u7', 'user')
		];
		expect(readingFor(path, readings, 1)).toBeNull();
		expect(readingFor(path, readings, 2)?.messageId).toBe('a2');
	});
});

describe('chorus: the opening is never read', () => {
	const state: ChorusChatState = { enabled: true, members: [member('x', 'Rowan')], presentOnly: false, presentDepth: 4 };

	test('every assistant turn before the first user turn is the opening, and nothing after it is', () => {
		const path = [msg('a0', 'assistant'), msg('a1', 'assistant'), msg('u2', 'user'), msg('a3', 'assistant')];
		expect(['a0', 'a1', 'u2', 'a3'].map((id) => isOpening(path, id))).toEqual([true, true, false, false]);
		expect(isOpening([msg('a0', 'assistant')], 'a0')).toBe(true);
		expect(isOpening(path, 'missing')).toBe(false);
	});

	test("a reading stored on the opening never reaches the first reply's prompt", () => {
		const readings: ChorusReadings = { a0: reading(1, [said('x', 'Rowan')]) };
		const send = [msg('a0', 'assistant'), msg('u1', 'user', 'hello')];
		expect(readingFor(send, readings, 5)).toBeNull();
		expect(chorusForPrompt(send, state, readings, SETTINGS)).toBeUndefined();
	});

	test("nor do the opening reading's goals", () => {
		const rowan = member('x', 'Rowan', { goals: { immediate: 'roster now', shortTerm: '', longTerm: '' } });
		const readings: ChorusReadings = {
			a0: reading(1, [said('x', 'Rowan', { goals: { immediate: 'guessed', shortTerm: '', longTerm: '' } })])
		};
		const path = [msg('a0', 'assistant'), msg('u1', 'user'), msg('a2', 'assistant')];
		expect(effectiveGoals(rowan, path, readings).immediate).toBe('roster now');
	});
});

describe('chorus: goals across a branched path', () => {
	const rowan = member('x', 'Rowan', { goals: { immediate: 'roster now', shortTerm: 'roster soon', longTerm: '' } });

	test('with no reading on the path, the roster speaks', () => {
		expect(effectiveGoals(rowan, [msg('u0', 'user'), msg('a1', 'assistant')], {})).toEqual(rowan.goals);
	});

	test('the newest reading on the path wins over the roster, at any distance', () => {
		const readings: ChorusReadings = {
			a1: reading(1, [said('x', 'Rowan', { goals: { immediate: 'read now', shortTerm: '', longTerm: 'read long' } })])
		};
		const path = [msg('u0', 'user'), msg('a1', 'assistant'), msg('u2', 'user'), msg('a3', 'assistant'), msg('a5', 'assistant')];
		expect(effectiveGoals(rowan, path, readings)).toEqual({
			immediate: 'read now',
			shortTerm: 'roster soon',
			longTerm: 'read long'
		});
	});

	test('a pinned goal beats every reading', () => {
		const pinned = { ...rowan, pinned: { ...NO_PINS, immediate: true } };
		const readings: ChorusReadings = {
			a1: reading(1, [said('x', 'Rowan', { goals: { immediate: 'read now', shortTerm: '', longTerm: '' } })])
		};
		expect(effectiveGoals(pinned, [msg('u0', 'user'), msg('a1', 'assistant')], readings).immediate).toBe('roster now');
	});

	test('a reading on another branch is never consulted', () => {
		const readings: ChorusReadings = {
			elsewhere: reading(9, [said('x', 'Rowan', { goals: { immediate: 'other branch', shortTerm: '', longTerm: '' } })])
		};
		expect(effectiveGoals(rowan, [msg('u0', 'user'), msg('a1', 'assistant')], readings).immediate).toBe('roster now');
	});

	test("a failed answer's goals do not count", () => {
		const readings: ChorusReadings = {
			a1: reading(1, [said('x', 'Rowan', { error: 'timed out', goals: { immediate: 'junk', shortTerm: '', longTerm: '' } })])
		};
		expect(effectiveGoals(rowan, [msg('u0', 'user'), msg('a1', 'assistant')], readings).immediate).toBe('roster now');
	});
});

describe('chorus: the block', () => {
	const state: ChorusChatState = {
		enabled: true,
		members: [member('x', 'Rowan'), member('y', 'Tamsin'), member('z', 'Corvin', { enabled: false })],
		presentOnly: false,
		presentDepth: 4
	};

	test('one line per answering member, in roster order; muted and failed members are left out', () => {
		const r = reading(1, [
			said('y', 'Tamsin', { want: 'to leave', intends: 'offers to fetch the copy' }),
			said('x', 'Rowan', { want: 'an admission', intends: 'waits' }),
			said('z', 'Corvin'),
			said('w', 'Gone from the roster')
		]);
		expect(renderIntentions(r, state)).toBe(
			'- Rowan\n  Wants: an admission\n  Would: waits\n- Tamsin\n  Wants: to leave\n  Would: offers to fetch the copy'
		);
		const failed = reading(1, [said('x', 'Rowan', { error: 'no' })]);
		expect(renderIntentions(failed, state)).toBe('');
	});

	test('nothing when the engine is off, the chat is off, or no reading is in range', () => {
		const path = [msg('u0', 'user'), msg('a1', 'assistant'), msg('u2', 'user')];
		const readings: ChorusReadings = { a1: reading(1, [said('x', 'Rowan')]) };
		expect(chorusForPrompt(path, state, readings, SETTINGS)).toBeDefined();
		expect(chorusForPrompt(path, state, readings, { ...SETTINGS, enabled: false })).toBeUndefined();
		expect(chorusForPrompt(path, { ...state, enabled: false }, readings, SETTINGS)).toBeUndefined();
		expect(chorusForPrompt(path, state, {}, SETTINGS)).toBeUndefined();
	});
});

describe('chorus: reading an answer', () => {
	test('JSON wrapped in prose and a fence is still read', () => {
		const raw = 'Sure! Here you go:\n```json\n{"want": "the truth", "intends": "asks again"}\n```';
		expect(parseChorusAnswer(raw, NO_GOALS, NO_PINS)).toEqual({
			want: 'the truth',
			intends: 'asks again',
			goals: NO_GOALS
		});
	});

	test('a goal left out or empty keeps its given value; a moved goal replaces it', () => {
		const given = { immediate: 'old now', shortTerm: 'old soon', longTerm: 'old long' };
		const a = parseChorusAnswer(
			'{"want": "w", "intends": "i", "goals": {"immediate": "new now", "shortTerm": ""}}',
			given,
			NO_PINS
		);
		expect(a?.goals).toEqual({ immediate: 'new now', shortTerm: 'old soon', longTerm: 'old long' });
	});

	test('a pinned goal is not moved by the answer', () => {
		const given = { immediate: 'mine', shortTerm: '', longTerm: '' };
		const a = parseChorusAnswer('{"want": "w", "intends": "i", "goals": {"immediate": "theirs"}}', given, {
			...NO_PINS,
			immediate: true
		});
		expect(a?.goals.immediate).toBe('mine');
	});

	test('an answer with neither field is a failure, not an empty member', () => {
		expect(parseChorusAnswer('I would rather not.', NO_GOALS, NO_PINS)).toBeNull();
		expect(parseChorusAnswer('{"goals": {}}', NO_GOALS, NO_PINS)).toBeNull();
	});
});

describe('chorus: in the assembled prompt', () => {
	function preset(items: string[]): any {
		return {
			id: 'p',
			name: 'p',
			controls: [],
			items: items.map((content) => ({ id: content, role: 'system', content, enabled: true }))
		};
	}

	const CHAT = [msg('u1', 'user', 'First.'), msg('a2', 'assistant', 'Reply.'), msg('u3', 'user', '.')];

	function input(over: Partial<AssembleInput> = {}): AssembleInput {
		return {
			preset: preset(['Rules.', '{{chatHistory}}']),
			resolvedCharacters: [],
			resolvedPersona: null,
			lorebooks: [],
			controls: [],
			customFields: {},
			chatMessages: CHAT,
			recall: { text: null, archivedIds: new Set<string>() },
			model: 'gpt-4o',
			postProcessing: { mode: 'none' },
			...over
		} as AssembleInput;
	}

	const CHORUS = { intentions: '- Rowan: wants an answer', wrapper: '[Wants: {{intentions}}]', depth: 0, role: 'system' as const };

	test('depth 0 lands after the newest turn, wrapper filled', () => {
		const a = assemblePrompt(input({ chorus: CHORUS }));
		expect(a.messages[a.messages.length - 1]).toEqual({ role: 'system', content: '[Wants: - Rowan: wants an answer]' });
		expect(a.messages[a.messages.length - 2].content).toBe('.');
	});

	test('at a shared depth it lands ahead of at-depth lore, and steering lands after both', () => {
		const book = createEmptyLorebook('b');
		book.entries = [
			{
				...createEmptyLorebookEntry(),
				content: 'REMINDERS',
				constant: true,
				position: LOREBOOK_POSITION_AT_DEPTH,
				depth: 0
			}
		];
		const a = assemblePrompt(
			input({
				chorus: CHORUS,
				lorebooks: [book],
				steering: { notes: [{ text: 'Steer.', depth: 0, role: 'system' }], wrapper: '{{steering}}' }
			})
		);
		const at = (needle: string) => a.messages.findIndex((m) => m.content.includes(needle));
		expect(at('Rowan')).toBeGreaterThan(at('.'));
		expect(at('REMINDERS')).toBeGreaterThan(at('Rowan'));
		expect(at('Steer.')).toBeGreaterThan(at('REMINDERS'));
	});

	test('it is priced as context and never trimmed', () => {
		const without = assemblePrompt(input());
		const withChorus = assemblePrompt(input({ chorus: CHORUS }));
		expect(withChorus.breakdown.context).toBeGreaterThan(without.breakdown.context);
		expect(withChorus.breakdown.total).toBe(
			withChorus.breakdown.preset + withChorus.breakdown.context + withChorus.breakdown.memory + withChorus.breakdown.chat
		);
	});

	test('a preset with no items still carries it', () => {
		const a = assemblePrompt(input({ preset: preset([]), chorus: CHORUS }));
		expect(a.messages.some((m) => m.content.includes('Rowan'))).toBe(true);
	});

	test('blank intentions inject nothing', () => {
		const a = assemblePrompt(input({ chorus: { ...CHORUS, intentions: '   ' } }));
		expect(a.messages.some((m) => m.content.includes('Wants'))).toBe(false);
	});
});

describe('chorus: only characters in the scene', () => {
	const LORE_DEFAULTS = { caseSensitive: false, matchWholeWords: true };

	test('a name counts the way a lorebook key does: whole word, any case', () => {
		expect(namedIn('Rowan', ['rowan shuts the door.'], LORE_DEFAULTS)).toBe(true);
		expect(namedIn('Rowan', ['The rowanberries are ripe.'], LORE_DEFAULTS)).toBe(false);
		expect(namedIn('Rowan', ['ROWAN!'], { caseSensitive: true, matchWholeWords: true })).toBe(false);
	});

	test('a two-word name matches as a phrase', () => {
		expect(namedIn('Tamsin Vale', ['and then Tamsin Vale arrived'], LORE_DEFAULTS)).toBe(true);
		expect(namedIn('Tamsin Vale', ['Tamsin arrived'], LORE_DEFAULTS)).toBe(false);
	});

	test('members split by whether the window names them, roster order kept', () => {
		const members = [member('x', 'Rowan'), member('y', 'Tamsin'), member('z', 'Corvin')];
		const { present, absent } = splitByPresence(members, ['Corvin waves.', 'Rowan nods.'], LORE_DEFAULTS);
		expect(present.map((m) => m.name)).toEqual(['Rowan', 'Corvin']);
		expect(absent.map((m) => m.name)).toEqual(['Tamsin']);
	});

	test('a read that skipped everyone is still a read, and keeps who it skipped', () => {
		const r = normalizeChorusReadings({ a1: { at: 1, members: [], skipped: ['x', 'y'] } });
		expect(r.a1).toEqual({ at: 1, members: [], skipped: ['x', 'y'] });
		expect(normalizeChorusReadings({ a1: { at: 1, members: [] } })).toEqual({});
	});

	test('a skipped member is left out of the block and keeps the goals of their own last answer', () => {
		const rowan = member('x', 'Rowan');
		const state: ChorusChatState = { enabled: true, members: [rowan, member('y', 'Tamsin')], presentOnly: true, presentDepth: 4 };
		const readings: ChorusReadings = {
			a1: reading(1, [said('x', 'Rowan', { goals: { immediate: 'earlier', shortTerm: '', longTerm: '' } })]),
			a2: { at: 2, members: [said('y', 'Tamsin')], skipped: ['x'] }
		};
		expect(renderIntentions(readings.a2, state)).not.toContain('Rowan');
		const path = [msg('u0', 'user'), msg('a1', 'assistant'), msg('a2', 'assistant')];
		expect(effectiveGoals(rowan, path, readings).immediate).toBe('earlier');
	});

	test('the depth is clamped to a sane window', () => {
		expect(normalizeChorusChatState({ presentDepth: 0 }).presentDepth).toBe(1);
		expect(normalizeChorusChatState({ presentDepth: 999 }).presentDepth).toBe(25);
		expect(normalizeChorusChatState({ presentDepth: 'x' }).presentDepth).toBe(4);
	});
});

describe('chorus: asking every few replies', () => {
	const path = ['u0', 'a1', 'u2', 'a3', 'u4', 'a5', 'u6', 'a7'].map((id) => msg(id, id[0] === 'a' ? 'assistant' : 'user'));

	test('every reply is read at 1', () => {
		for (const id of ['a1', 'a3', 'a5', 'a7']) expect(repliesUntilRead(path, id, 1)).toBe(0);
	});

	test('the first reply is read, then every n-th after it', () => {
		expect(['a1', 'a3', 'a5', 'a7'].map((id) => repliesUntilRead(path, id, 3))).toEqual([0, 2, 1, 0]);
	});

	test('the opening is not on the schedule, so the first reply after it is read', () => {
		const opened = [msg('a0', 'assistant'), ...path];
		expect(['a1', 'a3', 'a5', 'a7'].map((id) => repliesUntilRead(opened, id, 3))).toEqual([0, 2, 1, 0]);
	});

	test('the reach back grows by the replies the schedule skips', () => {
		expect(effectiveStaleLimit({ staleLimit: 1, every: 1 })).toBe(1);
		expect(effectiveStaleLimit({ staleLimit: 1, every: 3 })).toBe(3);
		expect(effectiveStaleLimit({ staleLimit: 0, every: 3 })).toBe(2);
	});

	test('between reads, the last read reply still feeds the prompt', () => {
		const state: ChorusChatState = { enabled: true, members: [member('x', 'Rowan')], presentOnly: false, presentDepth: 4 };
		const readings: ChorusReadings = { a1: reading(1, [said('x', 'Rowan')]) };
		const send = [...path.slice(0, 6), msg('u6', 'user', '.')];
		expect(chorusForPrompt(send, state, readings, SETTINGS)).toBeUndefined();
		expect(chorusForPrompt(send, state, readings, { ...SETTINGS, every: 3 })?.intentions).toContain('Rowan');
	});
});
