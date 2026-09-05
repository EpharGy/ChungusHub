/**
 * The image engine's reachability contract: what a turn costs when ComfyUI is not there.
 *
 * This is the behaviour a broken host makes expensive, and none of it is visible from the
 * pure marker tests - it lives entirely in how `ensureForMessage` sequences its calls. The
 * failure it pins is a real one: a failure is recorded against ONE marker, so the next
 * marker on the same turn has no record of its own and is asked anyway, and a reply
 * carrying three markers spends three connection timeouts arriving nowhere.
 *
 * Runes are compile-time macros and nothing compiles the store under bun test, so `$state`
 * is shimmed to identity BEFORE the store module loads, exactly as new-chat-flow.test.ts
 * does. Only `$state` is shimmed: growing a `$derived` or an `$effect` in this store fails
 * this file loudly rather than testing stale values.
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';

import type { Message } from '$lib/types/chat';

const runeIdentity = <T>(value?: T): T | undefined => value;
// `.raw` alongside the call itself: the real modules captured below reach for it, and it is the
// same identity shim either way.
(globalThis as unknown as { $state: unknown }).$state = Object.assign(runeIdentity, {
	raw: runeIdentity
});

/**
 * Bun's module registry is process-wide and one run loads every test file into it, so a stub left
 * standing here is served to every file that loads after this one, in whatever order the platform
 * walks the tree. Each stub below is therefore a SPREAD of the real module, so no export an
 * importer expects can go missing, and every one is put back in `afterAll` (architecture/testing.md;
 * contracts.test.ts fails this file if one is left standing).
 *
 * `$derived` is shimmed for the captures only and put back to whatever it was before, so growing a
 * `$derived` in the store under test still fails this file loudly, and no other file's shim is
 * disturbed by ours.
 */
const priorDerived = (globalThis as unknown as { $derived?: unknown }).$derived;
(globalThis as unknown as { $derived: unknown }).$derived = Object.assign(runeIdentity, {
	by: <T>(fn: () => T): T => fn()
});

const realImagegenService = { ...(await import('$lib/services/imagegenService')) };
const realSyncedSetting = { ...(await import('$lib/services/syncedSetting')) };
const realToast = { ...(await import('$lib/stores/toast.svelte')) };
const realDatabase = { ...(await import('$lib/services/database')) };
const realTransport = { ...(await import('$lib/services/transport')) };
const realMemory = { ...(await import('$lib/memory/store.svelte')) };
let realChat: Record<string, unknown> = {};

// Registered before the first stub goes in, so a throw anywhere in the setup below
// cannot leave one standing.
afterAll(() => {
	mock.module('$lib/services/imagegenService', () => realImagegenService);
	mock.module('$lib/services/syncedSetting', () => realSyncedSetting);
	mock.module('$lib/stores/toast.svelte', () => realToast);
	mock.module('$lib/services/database', () => realDatabase);
	mock.module('$lib/services/transport', () => realTransport);
	mock.module('$lib/memory/store.svelte', () => realMemory);
	mock.module('$lib/stores/chat.svelte', () => realChat);
});

/**
 * `chat.svelte` cannot be imported while its own import cycle is still live: chatPersona.svelte.ts
 * builds its store at module scope, and under the shims above its `$derived` class fields evaluate
 * eagerly and reach `chatStore` before chat.svelte has finished initialising. Stubbing these three
 * with spreads of themselves materialises that path and changes no behaviour - the same three, for
 * the same reason, that transcript-refresh.test.ts stubs. The real module is what gets restored.
 */
mock.module('$lib/services/database', () => ({ ...realDatabase }));
mock.module('$lib/services/transport', () => ({ ...realTransport }));
mock.module('$lib/memory/store.svelte', () => ({ ...realMemory }));
realChat = { ...(await import('$lib/stores/chat.svelte')) };
(globalThis as unknown as { $derived?: unknown }).$derived = priorDerived;

let pingResult = true;
let generateResult: 'ok' | 'throw' = 'ok';
let generateDelayMs = 0;
const pingCalls: string[] = [];
const generateCalls: unknown[] = [];
const warnings: string[] = [];

mock.module('$lib/services/imagegenService', () => ({
	...realImagegenService,
	pingComfy: async (host: string) => {
		pingCalls.push(host);
		return pingResult;
	},
	generateImage: async (req: unknown) => {
		generateCalls.push(req);
		// A picture takes a minute in life and nothing here by default. The delay is what
		// lets a case put a second pass INSIDE a generation rather than only before one.
		if (generateDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, generateDelayMs));
		if (generateResult === 'throw') throw new Error('ComfyUI did not answer');
		return { path: `images/chat/${generateCalls.length}.png`, promptId: 'p', filename: 'f.png' };
	}
}));

mock.module('$lib/services/syncedSetting', () => ({
	...realSyncedSetting,
	readSetting: async () => null,
	writeSetting: () => undefined,
	registerSettingsReload: () => undefined
}));

mock.module('$lib/stores/toast.svelte', () => ({
	...realToast,
	toastStore: {
		warning: (m: string) => warnings.push(m),
		failed: () => undefined,
		error: () => undefined,
		info: () => undefined,
		success: () => undefined
	}
}));

let message: Message;

mock.module('$lib/stores/chat.svelte', () => ({
	...realChat,
	chatStore: {
		get currentChatState() {
			return { chat: { id: 'c1' }, allMessages: [message], activePath: [message] };
		},
		refreshChat: async () => undefined
	}
}));

mock.module('$lib/services/database', () => ({
	...realDatabase,
	db: {
		updateMessageAttachments: async () => undefined
	}
}));

const { imagegenStore } = await import('./imagegen.svelte');

/** Each case gets its own message id. `failures` is keyed per marker and deliberately
 *  outlives a call, so reusing one id would let an earlier case decide a later one - and
 *  reaching into the store to clear it would be inventing a seam the app does not need. */
let nextId = 0;
let id = 'm0';

/** A reply carrying three markers and no pictures yet: the shape that made this expensive. */
function threeMarkerMessage(): Message {
	return {
		id,
		chatId: 'c1',
		parentId: null,
		role: 'assistant',
		content: 'a [[IMG: one ]] b [[IMG: two ]] c [[IMG: three ]]',
		attachments: null
	} as unknown as Message;
}

beforeEach(() => {
	id = `m${nextId++}`;
	message = threeMarkerMessage();
	pingCalls.length = 0;
	generateCalls.length = 0;
	warnings.length = 0;
	pingResult = true;
	generateResult = 'ok';
	generateDelayMs = 0;
	imagegenStore.update({ enabled: true, autoGenerate: true, host: 'http://gpu-box:8188' });
});

describe('reachability, on the automatic path', () => {
	test('an unreachable host costs one ping and no generation at all', async () => {
		pingResult = false;

		await imagegenStore.ensureForMessage(id);

		expect(pingCalls).toEqual(['http://gpu-box:8188']);
		expect(generateCalls).toHaveLength(0);
	});

	test('the outage is announced once, not once per turn', async () => {
		// A healthy turn first. The "already reported" flag is real state that outlives a
		// turn by design, so without this the assertion would be about whatever outage an
		// earlier case left standing rather than about this one.
		await imagegenStore.ensureForMessage(id);
		pingCalls.length = 0;
		warnings.length = 0;

		pingResult = false;
		for (let turn = 0; turn < 2; turn++) {
			id = `m${nextId++}`;
			message = threeMarkerMessage();
			await imagegenStore.ensureForMessage(id);
		}

		expect(pingCalls).toHaveLength(2);
		expect(warnings).toHaveLength(1);
	});

	test('a turn with nothing pending never asks whether the host is there', async () => {
		message = { ...threeMarkerMessage(), content: 'a reply with no markers in it' } as Message;

		await imagegenStore.ensureForMessage(id);

		expect(pingCalls).toHaveLength(0);
		expect(generateCalls).toHaveLength(0);
	});

	test('the first failure ends the turn instead of spending a timeout per marker', async () => {
		generateResult = 'throw';

		await imagegenStore.ensureForMessage(id);

		expect(generateCalls).toHaveLength(1);
	});

	test('a reachable host still generates every marker on the turn', async () => {
		await imagegenStore.ensureForMessage(id);

		expect(pingCalls).toHaveLength(1);
		expect(generateCalls).toHaveLength(3);
	});
});

describe('the buttons on a marker', () => {
	test('generate even when the last check said the host was gone', async () => {
		pingResult = false;
		await imagegenStore.ensureForMessage(id);
		expect(generateCalls).toHaveLength(0);

		await imagegenStore.generateOne(id, 0);

		expect(generateCalls).toHaveLength(1);
		// The click never consults the check, so it never adds a ping of its own either.
		expect(pingCalls).toHaveLength(1);
	});

	test('a picture that comes back clears the outage for the automatic path', async () => {
		pingResult = false;
		await imagegenStore.ensureForMessage(id);
		expect(imagegenStore.hostOffline).toBe(true);

		await imagegenStore.generateOne(id, 0);

		expect(imagegenStore.hostOffline).toBe(false);
	});
});

/**
 * Re-entrancy: two overlapping passes over the same turn.
 *
 * This is not a hypothetical. `ensureForNewestReply` is called from a `$effect`, and the
 * synchronous prefix of `ensureForMessage` reads `working`, `failures` and the row's
 * attachments - so the effect re-runs the moment any of them moves, which is exactly what
 * claiming a marker does. A pass that has not yet claimed anything is therefore the normal
 * state to be interrupted in, and every interrupting pass sees the same markers unclaimed.
 */
describe('two passes over the same turn', () => {
	test('overlapping passes generate each marker once, not once per pass', async () => {
		// Not awaited: the effect fires again while the first pass is still between its
		// marker list and its first claim, which is the whole window this guards.
		const first = imagegenStore.ensureForMessage(id);
		const second = imagegenStore.ensureForMessage(id);
		await Promise.all([first, second]);

		expect(generateCalls).toHaveLength(3);
	});

	test('a second pass does not re-ask whether the host is there', async () => {
		await Promise.all([imagegenStore.ensureForMessage(id), imagegenStore.ensureForMessage(id)]);

		expect(pingCalls).toHaveLength(1);
	});

	test('a pass arriving mid-picture does not start the markers ahead of it', async () => {
		// The realistic shape, and the expensive one: claiming a marker moves `working`, which
		// the asking effect reads, so the turn is re-asked while this pass is still on its
		// first picture and has claimed nothing beyond it.
		generateDelayMs = 5;
		const first = imagegenStore.ensureForMessage(id);
		await new Promise((resolve) => setTimeout(resolve, 1));
		const second = imagegenStore.ensureForMessage(id);
		await Promise.all([first, second]);

		expect(generateCalls).toHaveLength(3);
	});
});
