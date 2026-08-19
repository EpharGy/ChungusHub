/**
 * `getUserStats`, against the REAL server database (bun:sqlite).
 *
 * The aggregate is one streamed pass folding six different tallies at once, and every one
 * of them is a claim the stats screen prints as a headline. What this file guards is that
 * the claims stay distinct: effort counts the whole message forest and story counts only
 * the branch each chat is open at, so a chat full of rerolls must move the two figures by
 * different amounts. And that nothing is estimated: an unmeasured turn stays out of the
 * totals AND out of their denominators, or an average silently describes a corner of the
 * library while reading as the whole of it.
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
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-user-stats-'));
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

function makeChat(characterId: string | null = null): string {
	const id = crypto.randomUUID();
	serverDb.insertChat({
		id,
		title: 'Test chat',
		createdAt: clock,
		updatedAt: clock++,
		rootMessageId: null,
		activeLeafId: null,
		canonLeafId: null,
		settings: null,
		characterId,
		characterVersionId: null,
		isFavorite: false,
		featureState: null
	});
	return id;
}

function addMessage(
	chatId: string,
	parentId: string | null,
	role: string,
	content: string,
	extra: Record<string, unknown> = {}
): string {
	const id = crypto.randomUUID();
	serverDb.insertMessage({
		id,
		chatId,
		parentId,
		role,
		content,
		createdAt: (clock += 60_000),
		siblingIndex: 0,
		...extra
	});
	return id;
}

/** Cleared between tests so each one reads its own library and nothing else. */
function wipe() {
	for (const chat of serverDb.getAllChats() as { id: string }[]) serverDb.deleteChat(chat.id);
	for (const entry of serverDb.getAllLibraryEntries() as { id: string }[]) {
		serverDb.deleteLibraryEntry(entry.id);
	}
}

describe('effort and story are different questions', () => {
	test('a reroll counts as work done and not as story told', () => {
		wipe();
		const chatId = makeChat();
		const greeting = addMessage(chatId, null, 'assistant', 'one two three');
		const user = addMessage(chatId, greeting, 'user', 'four five');
		const kept = addMessage(chatId, user, 'assistant', 'six seven eight nine');
		addMessage(chatId, user, 'assistant', 'a rejected reply here', { siblingIndex: 1 });
		serverDb.updateChat({ id: chatId, rootMessageId: greeting, activeLeafId: kept });

		const stats = serverDb.getUserStats();
		// Four turns written, three of them on the branch the chat is open at.
		expect(stats.effort.messages).toBe(4);
		expect(stats.story.messages).toBe(3);
		expect(stats.effort.words).toBe(3 + 2 + 4 + 4);
		expect(stats.story.words).toBe(3 + 2 + 4);
		// The rejected reply is exactly the difference, counted from the other side.
		expect(stats.shape.abandoned).toBe(1);
	});

	test('it splits both by who was writing', () => {
		wipe();
		const chatId = makeChat();
		const greeting = addMessage(chatId, null, 'assistant', 'one two three');
		const user = addMessage(chatId, greeting, 'user', 'four five');
		serverDb.updateChat({ id: chatId, rootMessageId: greeting, activeLeafId: user });

		const stats = serverDb.getUserStats();
		expect(stats.effort.userWords).toBe(2);
		expect(stats.effort.assistantWords).toBe(3);
		expect(stats.effort.userMessages).toBe(1);
		expect(stats.effort.assistantMessages).toBe(1);
	});
});

describe('nothing is estimated', () => {
	test('an unmeasured turn stays out of the totals and out of their denominators', () => {
		wipe();
		const chatId = makeChat();
		// The imported shape: timings but no token counts, beside a turn generated here.
		const a = addMessage(chatId, null, 'assistant', 'imported reply', {
			generationMs: 4000,
			firstTokenMs: 800,
			reasoningMs: null
		});
		const b = addMessage(chatId, a, 'assistant', 'generated reply', {
			tokensPrompt: 1200,
			tokensCompletion: 300,
			generationMs: 6000,
			firstTokenMs: 900,
			reasoningMs: 2000
		});
		serverDb.updateChat({ id: chatId, rootMessageId: a, activeLeafId: b });

		const { measured } = serverDb.getUserStats();
		expect(measured.assistantTurns).toBe(2);
		// Tokens: one turn carried them, so that is the total AND the denominator.
		expect(measured.promptTokens).toBe(1200);
		expect(measured.promptTokenTurns).toBe(1);
		expect(measured.completionTokens).toBe(300);
		expect(measured.completionTokenTurns).toBe(1);
		// Timings: both turns carried these two, only one carried reasoning.
		expect(measured.generationMs).toBe(10000);
		expect(measured.generationTurns).toBe(2);
		expect(measured.firstTokenMs).toBe(1700);
		expect(measured.firstTokenTurns).toBe(2);
		expect(measured.reasoningMs).toBe(2000);
		expect(measured.reasoningTurns).toBe(1);
	});

	test('a library with nothing measured reports zero turns, never zero milliseconds', () => {
		// The whole point of the denominators: this library cannot be read as "instant".
		wipe();
		const chatId = makeChat();
		const only = addMessage(chatId, null, 'assistant', 'hello');
		serverDb.updateChat({ id: chatId, rootMessageId: only, activeLeafId: only });

		const { measured } = serverDb.getUserStats();
		expect(measured.assistantTurns).toBe(1);
		expect(measured.generationTurns).toBe(0);
		expect(measured.firstTokenTurns).toBe(0);
		expect(measured.reasoningTurns).toBe(0);
	});
});

describe('the activity series', () => {
	test('buckets to a quarter hour and comes back oldest first', () => {
		wipe();
		const chatId = makeChat();
		const base = 1_700_000_000_000;
		const at = (offset: number) => {
			const id = crypto.randomUUID();
			serverDb.insertMessage({
				id,
				chatId,
				parentId: null,
				role: 'user',
				content: 'x',
				createdAt: base + offset,
				siblingIndex: 0
			});
		};
		at(0);
		at(60_000); // same quarter hour as the first
		at(20 * 60_000); // the next one along
		at(-30 * 60_000); // earlier than everything above

		const { activity } = serverDb.getUserStats();
		expect(activity).toHaveLength(3);
		expect(activity.map((b: [number, number]) => b[1])).toEqual([1, 2, 1]);
		// Every bucket start is a clean quarter hour, which is what lets a client fold
		// them into local days without splitting one.
		for (const [start] of activity) expect(start % (15 * 60 * 1000)).toBe(0);
		expect(activity[0][0]).toBeLessThan(activity[1][0]);
	});
});

describe('the cast', () => {
	test('tallies per character across their chats, most-written first', () => {
		wipe();
		const alice = crypto.randomUUID();
		const bob = crypto.randomUUID();
		for (const [id, name] of [
			[alice, 'Alice'],
			[bob, 'Bob']
		]) {
			serverDb.insertLibraryEntry({
				id,
				type: 'character',
				data: { identity: { name }, data: {} },
				isFavorite: false,
				createdAt: clock,
				updatedAt: clock++
			});
		}

		const first = makeChat(alice);
		const second = makeChat(alice);
		const third = makeChat(bob);
		const a1 = addMessage(first, null, 'assistant', 'one two');
		serverDb.updateChat({ id: first, rootMessageId: a1, activeLeafId: a1 });
		const a2 = addMessage(second, null, 'assistant', 'three four five');
		serverDb.updateChat({ id: second, rootMessageId: a2, activeLeafId: a2 });
		const b1 = addMessage(third, null, 'assistant', 'six');
		serverDb.updateChat({ id: third, rootMessageId: b1, activeLeafId: b1 });

		const { cast } = serverDb.getUserStats();
		expect(cast).toHaveLength(2);
		expect(cast[0].characterId).toBe(alice);
		expect(cast[0].chats).toBe(2);
		expect(cast[0].messages).toBe(2);
		expect(cast[0].words).toBe(5);
		expect(cast[1].characterId).toBe(bob);
		expect(cast[1].chats).toBe(1);
	});

	test('leaves chats with no character out of it rather than inventing one', () => {
		wipe();
		const chatId = makeChat(null);
		const only = addMessage(chatId, null, 'assistant', 'orphan turn');
		serverDb.updateChat({ id: chatId, rootMessageId: only, activeLeafId: only });

		const stats = serverDb.getUserStats();
		expect(stats.cast).toHaveLength(0);
		// The turn still counts as work: only its attribution is missing.
		expect(stats.effort.messages).toBe(1);
	});
});

describe('records and shelves', () => {
	test('names the longest reply, the longest thing you wrote and the longest story', () => {
		wipe();
		const quiet = makeChat();
		const busy = makeChat();
		const q = addMessage(quiet, null, 'assistant', 'short');
		serverDb.updateChat({ id: quiet, rootMessageId: q, activeLeafId: q });

		const b1 = addMessage(busy, null, 'assistant', 'one two three four five six');
		const b2 = addMessage(busy, b1, 'user', 'a much longer thing than the other one here');
		const b3 = addMessage(busy, b2, 'assistant', 'tail');
		serverDb.updateChat({ id: busy, rootMessageId: b1, activeLeafId: b3 });

		const { records, shape } = serverDb.getUserStats();
		expect(records.longestReply).toEqual({ chatId: busy, words: 6 });
		expect(records.longestUserTurn).toEqual({ chatId: busy, words: 9 });
		expect(records.longestChat).toEqual({ chatId: busy, messages: 3 });
		expect(shape.longestStory).toBe(3);
	});

	test('an empty library answers with zeroes and nulls, never a crash', () => {
		wipe();
		const stats = serverDb.getUserStats();
		expect(stats.effort.messages).toBe(0);
		expect(stats.story.words).toBe(0);
		expect(stats.activity).toEqual([]);
		expect(stats.cast).toEqual([]);
		expect(stats.records.longestReply).toBeNull();
		expect(stats.records.firstMessageAt).toBeNull();
		expect(stats.library.chats).toBe(0);
	});
});
