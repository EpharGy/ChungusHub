/**
 * The image engine's arrival contract: what a chat still owes when the reader walks back into it.
 *
 * The gap this pins is real and was shipped. A reply is committed by the SERVER, so it lands
 * whether or not the page that asked for it is still on that chat - but the trigger that makes
 * its pictures fires from the generation that placed the row and resolves that row through the
 * OPEN chat. Switch character mid-reply and the markers are passed over silently, and nothing
 * ever re-asks: the trigger runs once, per generation, and a chat load ran nothing at all.
 *
 * `ensureForNewestReply` is the second chance, on the Sprites engine's terms - the transcript
 * asks on every change and the store decides whether that means a call. The half of the contract
 * worth pinning is the BOUND: the newest reply only, never a sweep back through the branch,
 * because opening an old chat that accumulated markers must not queue a pile of GPU jobs.
 *
 * Runes are compile-time macros and nothing compiles the store under bun test, so `$state` is
 * shimmed to identity BEFORE the store module loads, exactly as imagegen-preflight.test.ts does.
 * Only `$state` is shimmed, and the store holds no other rune - `newestReply` is a plain getter
 * for that reason.
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

const generateCalls: unknown[] = [];
const pingCalls: string[] = [];

mock.module('$lib/services/imagegenService', () => ({
	...realImagegenService,
	pingComfy: async (host: string) => {
		pingCalls.push(host);
		return true;
	},
	generateImage: async (req: unknown) => {
		generateCalls.push(req);
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
		warning: () => undefined,
		failed: () => undefined,
		error: () => undefined,
		info: () => undefined,
		success: () => undefined
	}
}));

/** The open chat's branch, root-first. The store walks it backwards looking for a reply. */
let path: Message[] = [];

mock.module('$lib/stores/chat.svelte', () => ({
	...realChat,
	chatStore: {
		get currentChatState() {
			return { chat: { id: 'c1' }, allMessages: path, activePath: path };
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

/** Fresh ids per case: `failures` is keyed per marker and deliberately outlives a call, so a
 *  reused id would let an earlier case decide a later one. */
let nextId = 0;

function turn(role: 'user' | 'assistant', content: string): Message {
	return {
		id: `m${nextId++}`,
		chatId: 'c1',
		parentId: null,
		role,
		content,
		attachments: null
	} as unknown as Message;
}

/** `ensureForNewestReply` is fire-and-forget by design - the transcript must not wait on a
 *  picture - so the assertions wait on the work it started rather than on the call itself. A
 *  macrotask drains every microtask the mocked service chain queues. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	generateCalls.length = 0;
	pingCalls.length = 0;
	path = [];
	imagegenStore.update({ enabled: true, autoGenerate: true, host: 'http://gpu-box:8188' });
});

describe('arriving at a chat whose newest reply was missed', () => {
	test('its markers are made, without anything else asking', async () => {
		path = [turn('user', 'hello'), turn('assistant', 'a [[IMG: newest ]] b')];

		imagegenStore.ensureForNewestReply();
		await settle();

		expect(generateCalls).toHaveLength(1);
		expect(JSON.stringify(generateCalls)).toContain('newest');
	});

	test('only the newest reply is asked about, never the branch behind it', async () => {
		// The bound that keeps this cheap. An older turn with markers of its own is exactly the
		// backlog a sweep would queue, and the reader asked for none of it.
		path = [
			turn('assistant', 'x [[IMG: older ]] y'),
			turn('user', 'go on'),
			turn('assistant', 'z [[IMG: newest ]] w')
		];

		imagegenStore.ensureForNewestReply();
		await settle();

		expect(generateCalls).toHaveLength(1);
		const sent = JSON.stringify(generateCalls);
		expect(sent).toContain('newest');
		expect(sent).not.toContain('older');
	});

	test('the newest REPLY is found past a user turn sitting after it', async () => {
		// The reader's own message is newest on the path, and the reply it follows is still the
		// turn that owes pictures. Same walk as the Sprites engine's.
		path = [turn('assistant', 'a [[IMG: newest ]] b'), turn('user', 'anything?')];

		imagegenStore.ensureForNewestReply();
		await settle();

		expect(generateCalls).toHaveLength(1);
		expect(JSON.stringify(generateCalls)).toContain('newest');
	});

	test('a branch with no reply on it asks nothing at all', async () => {
		path = [turn('user', 'hello')];

		imagegenStore.ensureForNewestReply();
		await settle();

		expect(pingCalls).toHaveLength(0);
		expect(generateCalls).toHaveLength(0);
	});

	test('the engine being off is the one gate, and it holds here too', async () => {
		path = [turn('assistant', 'a [[IMG: newest ]] b')];
		imagegenStore.update({ enabled: false });

		imagegenStore.ensureForNewestReply();
		await settle();

		expect(pingCalls).toHaveLength(0);
		expect(generateCalls).toHaveLength(0);
	});

	test('auto-generate off leaves arrival to the buttons, as it does a landing reply', async () => {
		path = [turn('assistant', 'a [[IMG: newest ]] b')];
		imagegenStore.update({ autoGenerate: false });

		imagegenStore.ensureForNewestReply();
		await settle();

		expect(pingCalls).toHaveLength(0);
		expect(generateCalls).toHaveLength(0);
	});
});
