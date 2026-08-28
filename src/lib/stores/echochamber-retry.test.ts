/**
 * What a failed feed costs: the half of the engine that is not visible from the pure tests.
 *
 * `ensureForNewestReply` is called from a `$effect` whose synchronous prefix reads
 * `generatingFor` and the turn's feed. Clearing `generatingFor` in the `finally` therefore
 * re-runs the effect that asked - and a turn that just failed has no feed and is no longer
 * generating, so it qualified again immediately. One unreachable connection was an unbounded
 * loop of model calls, each with its own toast. What is pinned here is a count.
 *
 * Runes are compile-time macros and nothing compiles the store under bun test, so `$state` is
 * shimmed to identity BEFORE the store module loads, exactly as imagegen-preflight.test.ts
 * does. Only `$state` is shimmed: growing a `$derived` or an `$effect` in this store fails
 * this file loudly rather than testing stale values.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

import type { Message } from '$lib/types/chat';

(globalThis as unknown as { $state: <T>(v?: T) => T | undefined }).$state = (v) => v;

let completeResult: 'ok' | 'throw' | 'unreadable' = 'ok';
const completeCalls: unknown[] = [];
const errors: string[] = [];

mock.module('$lib/services/llm/provider', () => ({
	llmService: {
		complete: async (_engine: unknown, req: unknown) => {
			completeCalls.push(req);
			if (completeResult === 'throw') throw new Error('no connection is configured');
			// A reply the parser can read nothing out of is the other way a turn ends with no
			// feed filed, and it loops for exactly the same reason.
			return { content: completeResult === 'unreadable' ? '...' : 'someone: what a scene' };
		}
	}
}));

let feedState: { feeds: Record<string, unknown> } = { feeds: {} };
let messages: Message[] = [];

mock.module('$lib/stores/chat.svelte', () => ({
	chatStore: {
		get currentChatState() {
			return { chat: { id: 'c1', characterId: null }, allMessages: messages, activePath: messages };
		},
		featureState: () => ({ echoChamber: feedState }),
		updateChatFeatureState: async (_id: string, patch: { echoChamber: typeof feedState }) => {
			feedState = patch.echoChamber;
		}
	}
}));

mock.module('$lib/stores/characterLibrary.svelte', () => ({ characterLibraryStore: { entries: [] } }));
mock.module('$lib/stores/persona.svelte', () => ({ personaStore: { activeEntry: null } }));
mock.module('$lib/lorebook/store.svelte', () => ({ lorebookStore: { books: [] } }));
mock.module('$lib/memory/store.svelte', () => ({ memoryStore: { recall: '' } }));
// `$lib/macros` is deliberately NOT mocked. A module mock is process-wide and outlives the
// file that declares it, and the real `expandMacros` is what prompt-assembly.test.ts asserts
// against - stubbing it here turned that file red from across the suite. Only the live
// context, which would otherwise reach half the app's stores, is replaced.
mock.module('$lib/utils/live-macro-context', () => ({ buildLiveMacroContext: () => ({}) }));
mock.module('$lib/services/syncedSetting', () => ({
	readSetting: async () => null,
	writeSetting: () => undefined,
	registerSettingsReload: () => undefined
}));
mock.module('$lib/stores/toast.svelte', () => ({
	toastStore: {
		error: (m: string) => errors.push(m),
		warning: () => undefined,
		failed: () => undefined,
		info: () => undefined,
		success: () => undefined
	}
}));

const settings = {
	enabled: true,
	autoGenerate: true,
	styleId: 'twitch',
	reactionCount: 6,
	includeUserInput: false,
	contextDepth: 4,
	includePersona: false,
	includeCharacterDescription: false,
	includeLorebook: false,
	includeMemory: false,
	includePastReactions: false,
	messageOrder: 'oldest-first' as const
};

mock.module('$lib/echochamber/settings.svelte', () => ({
	echoChamberSettings: {
		current: settings,
		initialize: async () => undefined,
		update: () => undefined
	}
}));

const { echoChamberStore } = await import('./echochamber.svelte');

/** A user turn and the reply under it: the shape `findActivePath` walks. */
function chat(replyContent: string): Message[] {
	return [
		{ id: 'u1', chatId: 'c1', parentId: null, role: 'user', content: 'I open the door.' },
		{ id: reply, chatId: 'c1', parentId: 'u1', role: 'assistant', content: replyContent }
	] as unknown as Message[];
}

/** Each case gets its own reply id. The failure guard is keyed per turn and deliberately
 *  outlives a call, so reusing one id would let an earlier case decide a later one - and
 *  reaching into the store to clear it would be inventing a seam the app does not need. */
let nextId = 0;
let reply = 'a0';

beforeEach(() => {
	reply = `a${nextId++}`;
	feedState = { feeds: {} };
	messages = chat('The hall is dark.');
	completeCalls.length = 0;
	errors.length = 0;
	completeResult = 'ok';
});

describe('a turn whose feed failed', () => {
	test('is asked for once, however many times the widget re-asks', async () => {
		completeResult = 'throw';

		for (let ask = 0; ask < 4; ask++) await echoChamberStore.ensureForMessage(reply);

		expect(completeCalls).toHaveLength(1);
		expect(errors).toHaveLength(1);
	});

	test('a reply the parser can read nothing out of counts the same', async () => {
		completeResult = 'unreadable';

		for (let ask = 0; ask < 4; ask++) await echoChamberStore.ensureForMessage(reply);

		expect(completeCalls).toHaveLength(1);
	});

	test('is asked again once the turn itself changes, because that is a new question', async () => {
		completeResult = 'throw';
		await echoChamberStore.ensureForMessage(reply);

		// What a continue or an edit does to the row the guard is keyed against.
		messages = chat('The hall is dark. Something moves.');
		await echoChamberStore.ensureForMessage(reply);

		expect(completeCalls).toHaveLength(2);
	});

	test('the regenerate button ignores the guard, and a feed clears it', async () => {
		completeResult = 'throw';
		await echoChamberStore.ensureForMessage(reply);
		expect(completeCalls).toHaveLength(1);

		completeResult = 'ok';
		await echoChamberStore.regenerate(reply);

		expect(completeCalls).toHaveLength(2);
		expect(feedState.feeds[reply]).toBeTruthy();
	});
});

describe('a turn whose feed succeeded', () => {
	test('is not asked for again', async () => {
		await echoChamberStore.ensureForMessage(reply);
		await echoChamberStore.ensureForMessage(reply);

		expect(completeCalls).toHaveLength(1);
	});
});
