/**
 * What `messages.sprite_label` survives, against the REAL server database (bun:sqlite).
 *
 * The column holds the LABEL the chat resolves a turn's sprite from. **Nothing on the server ever
 * clears it**: whether a rewritten turn gets read again is the user's setting (Settings →
 * Engines → Sprites), so the decision belongs to the client call sites that know about it,
 * exactly like chat memory's summary invalidation. This file pins the server half: that
 * a content rewrite leaves the reading standing, and that writing a reading is not an edit.
 *
 * Same env dance as greetingRefresh.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway dir
 * before the first db call, so no test can silently write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-sprite-label-'));
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

/** A chat holding one assistant turn already read as `label`. */
function makeReadTurn(label: string, content = 'She smiled.'): string {
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
		content,
		createdAt: clock++,
		siblingIndex: 0
	});
	serverDb.updateMessageSpriteLabel(messageId, label);
	return messageId;
}

const labelOf = (id: string) => serverDb.getMessage(id).spriteLabel;

describe('the server never decides a reading is stale', () => {
	test('it round-trips as written', () => {
		const id = makeReadTurn('joy');
		expect(labelOf(id)).toBe('joy');
	});

	test('an ordinary edit leaves it standing: re-reading is the client’s gated choice', () => {
		const id = makeReadTurn('joy');
		serverDb.updateMessageContent(id, 'She turned away.');
		expect(labelOf(id)).toBe('joy');
	});

	test('so does a MINOR edit, which never re-reads under any setting', () => {
		const id = makeReadTurn('joy');
		serverDb.updateMessageContent(id, 'She smiled!', { minor: true });
		expect(labelOf(id)).toBe('joy');
	});

	test('so does a continuation', () => {
		const id = makeReadTurn('joy');
		serverDb.applyMessageContinuation(id, {
			content: 'She smiled. Then the smile went out of her.',
			thinking: null,
			tokensPrompt: null,
			tokensCompletion: null,
			finishReason: 'stop',
			generationMs: 10,
			reasoningMs: null
		});
		expect(labelOf(id)).toBe('joy');
	});

	test('writing the reading itself touches neither edit stamp', () => {
		const id = makeReadTurn('joy');
		const before = serverDb.getMessage(id);
		serverDb.updateMessageSpriteLabel(id, 'anger');
		const after = serverDb.getMessage(id);
		expect(after.spriteLabel).toBe('anger');
		expect(after.editedAt).toBe(before.editedAt);
		expect(after.minorEditedAt).toBe(before.minorEditedAt);
		expect(after.content).toBe(before.content);
	});

	test('clearing it by hand is the one way it goes: what a gated re-read calls', () => {
		const id = makeReadTurn('joy');
		serverDb.updateMessageSpriteLabel(id, null);
		expect(labelOf(id)).toBeNull();
	});

	test('a duplicated chat carries the readings, since it is the same story', () => {
		const id = makeReadTurn('joy');
		const chatId = serverDb.getMessage(id).chatId;
		const copyId = serverDb.duplicateChat({ chatId, title: 'Copy', includeMemory: false });
		const copied = serverDb.getMessagesByChat(copyId as string);
		expect(copied.map((m: any) => m.spriteLabel)).toEqual(['joy']);
	});
});
