/**
 * What the three generation clocks on a message survive, against the REAL server database
 * (bun:sqlite): `generation_ms`, `first_token_ms` and `reasoning_ms`.
 *
 * Two of them accumulate across a continuation and one must never move, which is the whole
 * reason this file exists. `first_token_ms` records WHEN a turn started speaking, and that
 * happened once, on the run that created it; `generation_ms` and `reasoning_ms` record HOW
 * MUCH the turn cost, so a continuation adds to them. Fold the first into the same rule as
 * the other two and every continued turn reports a wait that never happened.
 *
 * Same env dance as messageSpriteLabel.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway
 * dir before the first db call, so no test can silently write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-msg-timings-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	// One handle per process, bound on first use (see server/db.ts). Release whatever an
	// earlier file left open so this file's first db call binds to the dir above.
	serverDb.closeForTests();
});

afterAll(() => {
	// Release before deleting: statements against an unlinked file fail for the rest of the run.
	serverDb.closeForTests();
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

let clock = 1_700_000_000_000;

/** A chat holding one timed assistant turn. Returns both ids: the copy tests need the chat. */
function makeTimedTurn(timings: Record<string, number | null>): { chatId: string; messageId: string } {
	const chatId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	serverDb.insertChat({
		id: chatId,
		title: 'Test',
		createdAt: clock,
		updatedAt: clock++,
		rootMessageId: messageId,
		activeLeafId: messageId,
		canonLeafId: null,
		settings: null,
		characterId: null,
		characterVersionId: null,
		isFavorite: false,
		featureState: null
	});
	serverDb.insertMessage({
		id: messageId,
		chatId,
		parentId: null,
		role: 'assistant',
		content: 'She smiled.',
		createdAt: clock++,
		siblingIndex: 0,
		...timings
	});
	return { chatId, messageId };
}

const FULL = { generationMs: 7000, firstTokenMs: 900, reasoningMs: 4100 };

describe('the three generation clocks', () => {
	test('round-trip as written', () => {
		const { messageId } = makeTimedTurn(FULL);
		expect(serverDb.getMessage(messageId)).toMatchObject(FULL);
	});

	test('read back as null when nobody measured them', () => {
		const { messageId } = makeTimedTurn({});
		expect(serverDb.getMessage(messageId)).toMatchObject({
			generationMs: null,
			firstTokenMs: null,
			reasoningMs: null
		});
	});

	test('survive a chat duplication', () => {
		// The copy is the same story: a turn that took seven seconds took seven seconds in it.
		const { chatId } = makeTimedTurn(FULL);
		const copyId = serverDb.duplicateChat({ chatId, title: 'copy', includeMemory: false });
		const copied = serverDb.getMessagesByChat(copyId);
		expect(copied).toHaveLength(1);
		expect(copied[0]).toMatchObject(FULL);
	});
});

describe('a continuation adds to the cost and never rewrites the wait', () => {
	/** The caller accumulates, exactly as messages.svelte.ts does; the db writes what it is given. */
	function continueTurn(messageId: string, addedGeneration: number, addedReasoning: number | null) {
		const before = serverDb.getMessage(messageId);
		serverDb.applyMessageContinuation(messageId, {
			content: before.content + ' Then the smile went out of her.',
			thinking: null,
			tokensPrompt: null,
			tokensCompletion: null,
			finishReason: 'stop',
			generationMs: (before.generationMs ?? 0) + addedGeneration,
			reasoningMs:
				before.reasoningMs === null && addedReasoning === null
					? null
					: (before.reasoningMs ?? 0) + (addedReasoning ?? 0)
		});
		return serverDb.getMessage(messageId);
	}

	test('leaves first_token_ms exactly where the original run put it', () => {
		const { messageId } = makeTimedTurn(FULL);
		expect(continueTurn(messageId, 3000, 500).firstTokenMs).toBe(900);
	});

	test('accumulates generation and reasoning', () => {
		const { messageId } = makeTimedTurn(FULL);
		const after = continueTurn(messageId, 3000, 500);
		expect(after.generationMs).toBe(10000);
		expect(after.reasoningMs).toBe(4600);
	});

	test('a reasoning-free turn continued by a reasoning-free run stays unmeasured', () => {
		// Not zero: nobody reasoned and nobody measured, and those are different claims.
		const { messageId } = makeTimedTurn({ generationMs: 7000, firstTokenMs: 900, reasoningMs: null });
		expect(continueTurn(messageId, 3000, null).reasoningMs).toBeNull();
	});

	test('an untimed turn continued by a timed run reports the run that was measured', () => {
		// The imported-then-continued case: the source file said nothing, this run did.
		const { messageId } = makeTimedTurn({});
		const after = continueTurn(messageId, 3000, 500);
		expect(after.generationMs).toBe(3000);
		expect(after.reasoningMs).toBe(500);
		expect(after.firstTokenMs).toBeNull();
	});
});
