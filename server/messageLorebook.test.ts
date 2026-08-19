/**
 * What the lorebook trace on a message survives, against the REAL server database
 * (bun:sqlite): `lore_json`.
 *
 * Three properties this file exists to hold. It round-trips as the record the client wrote,
 * because the panel reading it back is only as honest as the storage under it. It survives a
 * chat duplication, since the copy is the same story and its turns were built the same way.
 * And a cell that will not parse reads as a turn nobody traced instead of taking the whole
 * transcript down with it: this is a debug record, and no debug record may cost a reader the
 * story it is attached to.
 *
 * Same env dance as messageTimings.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway dir
 * before the first db call, so no test can silently write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-msg-lorebook-'));
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

const TRACE = {
	records: [
		{
			bookId: 'book-1',
			bookName: 'Eldoria',
			entryId: 'entry-1',
			title: 'Wolves',
			status: 'keyword',
			matches: [
				{
					key: 'wolf',
					role: 'primary',
					source: { kind: 'message', depth: 1 },
					excerpt: '…a wolf howls in the dark…'
				}
			]
		},
		{
			bookId: 'book-1',
			bookName: 'Eldoria',
			entryId: 'entry-2',
			title: 'Storm',
			status: 'rolledOut',
			matches: [],
			probability: 25
		}
	],
	silent: 12
};

/** A chat holding one assistant turn, traced or not. Returns both ids: the copy test needs the chat. */
function makeTurn(lorebook: unknown): { chatId: string; messageId: string } {
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
		content: 'The pack circled the fire.',
		createdAt: clock++,
		siblingIndex: 0,
		lorebook
	});
	return { chatId, messageId };
}

describe('the lorebook trace on a turn', () => {
	test('round-trips as written, evidence and all', () => {
		const { messageId } = makeTurn(TRACE);
		expect(serverDb.getMessage(messageId).lorebook).toEqual(TRACE);
	});

	test('reads back as null for a turn nobody scanned for', () => {
		// User turns, seeded greetings, imported chats: no scan ran, so there is nothing to claim.
		const { messageId } = makeTurn(null);
		expect(serverDb.getMessage(messageId).lorebook).toBeNull();
	});

	test('survives a chat duplication', () => {
		const { chatId } = makeTurn(TRACE);
		const copyId = serverDb.duplicateChat({ chatId, title: 'copy', includeMemory: false });
		const copied = serverDb.getMessagesByChat(copyId);
		expect(copied).toHaveLength(1);
		expect(copied[0].lorebook).toEqual(TRACE);
	});

	test('a corrupt cell costs the trace and nothing else', () => {
		const { chatId, messageId } = makeTurn(TRACE);
		serverDb.execute('UPDATE messages SET lore_json = ? WHERE id = ?', ['{not json', messageId]);
		const row = serverDb.getMessage(messageId);
		expect(row.lorebook).toBeNull();
		expect(row.content).toBe('The pack circled the fire.');
		// And the transcript around it still reads, which is the whole point of the guard.
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(1);
	});
});
