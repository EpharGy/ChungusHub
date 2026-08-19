/**
 * Integration tests: the engine driven against the REAL server database (bun:sqlite),
 * not the in-memory fake. This exercises the actual SQL + transactions for the hard paths
 * (memApplyBatch / memApplyPromotion / memReapEpisodes) and simulates the exact
 * message-tree shapes that swipe / retry / branch / delete produce in the app, then checks
 * that memory stays consistent. Run with `bun test`.
 *
 * It does NOT launch the app: it points the server DB at a throwaway directory via
 * CHUNGUS_DATA_DIR and talks to ServerDatabase directly (the same methods the RPC bridge
 * calls), so it's a faithful test of the persistence layer the UI relies on.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processChat, syncCoverage, rebuildChat, type EngineDeps } from './engine';
import { resolveCoverage, type Coverage } from './branching';
import { resolveConfig } from './config';
import { buildRecall } from './recall';
import { DEFAULT_EXTRACT_TEMPLATE, DEFAULT_PROMOTE_TEMPLATE } from './prompts';
import type { LlmFn, MemoryConfig, MemoryDb, MemoryMessage } from './types';

let serverDb: any;
let dataDir: string;
let uid = 0;
const id = (p: string) => `${p}-${++uid}`;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-mem-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('../../../server/db'));
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

/** A MemoryDb backed by the real ServerDatabase (sync calls wrapped as promises). */
function realDb(): MemoryDb {
	return {
		getState: async (c) => serverDb.memGetState(c),
		setState: async (c, p) => serverDb.memSetState(c, p),
		listEpisodes: async (c) => serverDb.memListEpisodes(c),
		applyBatch: async (c, r) => serverDb.memApplyBatch(c, r),
		applyPromotion: async (c, r) => serverDb.memApplyPromotion(c, r),
		reapEpisodes: async (c, ids) => serverDb.memReapEpisodes(c, ids),
		updateEpisodeContent: async (c, e, ct) => serverDb.memUpdateEpisodeContent(c, e, ct),
		reset: async (c) => serverDb.memReset(c)
	};
}

type Handler = (db: MemoryDb, chatId: string) => unknown;

function scriptedLlm(handlers: Handler[], db: MemoryDb, chatId: string): LlmFn {
	let i = 0;
	let promo = 0;
	return async (messages) => {
		if (messages[0].content.includes('EPISODES TO MERGE:')) {
			promo++;
			return JSON.stringify({ episode: `merged#${promo}` });
		}
		const h = handlers[Math.min(i, handlers.length - 1)];
		i++;
		// Handlers may be async (they read the real DB to find ids); resolve to JSON.
		return JSON.stringify(await h(db, chatId));
	};
}

function deps(db: MemoryDb, llm: LlmFn): EngineDeps {
	return { db, llm, templates: { extract: DEFAULT_EXTRACT_TEMPLATE, promote: DEFAULT_PROMOTE_TEMPLATE } };
}

/** Create a real chat row (FK target) and turn memory on for it. */
async function newChat(config: Partial<MemoryConfig>): Promise<string> {
	const chatId = id('chat');
	const now = Date.now();
	serverDb.insertChat({
		id: chatId,
		title: 'test',
		createdAt: now,
		updatedAt: now,
		rootMessageId: null,
		activeLeafId: null,
		settings: null,
		characterId: null
	});
	serverDb.memSetState(chatId, { enabled: true, config });
	return chatId;
}

function linear(n: number, prefix = 'm'): MemoryMessage[] {
	const out: MemoryMessage[] = [];
	for (let i = 0; i < n; i++) {
		out.push({
			id: `${prefix}${i}`,
			parentId: i === 0 ? null : `${prefix}${i - 1}`,
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: `turn ${i}`,
			speaker: i % 2 === 0 ? 'User' : 'Char'
		});
	}
	return out;
}

const addEp = (n: string) => () => ({ episode: `ep ${n}` });

/** The derived state, resolved against the rows the real db holds right now. */
function coverageOf(chatId: string, allMessages: MemoryMessage[], leafId: string | null): Coverage {
	const config = resolveConfig(serverDb.memGetState(chatId)?.config);
	return resolveCoverage(allMessages, leafId, serverDb.memListEpisodes(chatId), config.verbatimTail);
}

/**
 * Invariants against the real rows: no two episodes cover the same turn (what the SQL guard
 * enforces and what makes a derived boundary well-defined), the archived prefix is covered
 * gap-free by ACTIVE episodes, and nothing active covers a turn still sent verbatim.
 */
function assertConsistent(chatId: string, allMessages: MemoryMessage[], leafId: string | null) {
	const episodes = serverDb.memListEpisodes(chatId);
	const seen = new Set<string>();
	for (const e of episodes) {
		for (const mid of e.sourceMessageIds) {
			expect(seen.has(mid)).toBe(false);
			seen.add(mid);
		}
	}
	const c = coverageOf(chatId, allMessages, leafId);
	const covered = new Set(c.active.flatMap((e: any) => e.sourceMessageIds));
	for (const aid of c.archivedIds) expect(covered.has(aid)).toBe(true);
	for (const cid of covered) expect(c.archivedIds.has(cid as string)).toBe(true);
}

describe('integration: real SQL + simulated branching', () => {
	test('build over a linear chat persists episodes and derives a correct boundary', async () => {
		const chatId = await newChat({ batchSize: 10, verbatimTail: 10 });
		const msgs = linear(30);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('a'), addEp('b')], db, chatId)), chatId, msgs, 'm29');

		// 30 - 10 tail = 20 eligible → 2 batches; boundary at m19.
		expect(coverageOf(chatId, msgs, 'm29').cursorMessageId).toBe('m19');
		expect(serverDb.memListEpisodes(chatId).length).toBe(2);
		assertConsistent(chatId, msgs, 'm29');

		const recall = buildRecall(coverageOf(chatId, msgs, 'm29').active)!;
		expect(recall).toContain('ep a');
		expect(recall).toContain('ep b');
	});

	test('swipe in the live zone leaves memory untouched', async () => {
		const chatId = await newChat({ batchSize: 10, verbatimTail: 10 });
		const msgs = linear(30);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('x')], db, chatId)), chatId, msgs, 'm29');
		const epsBefore = serverDb.memListEpisodes(chatId).length;

		// Swipe the last assistant turn: m28 → m29b (a sibling). Pure live-zone change.
		const swiped: MemoryMessage[] = [...msgs, { id: 'm29b', parentId: 'm28', role: 'assistant', content: 'alt', speaker: 'Char' }];
		expect(await syncCoverage(deps(db, async () => ''), chatId, swiped, 'm29b')).toEqual({ reaped: 0 });
		expect(coverageOf(chatId, swiped, 'm29b').cursorMessageId).toBe('m19');
		expect(serverDb.memListEpisodes(chatId).length).toBe(epsBefore);
		assertConsistent(chatId, swiped, 'm29b');
	});

	test('a deep branch retreats the boundary in real SQL without deleting a row', async () => {
		const chatId = await newChat({ batchSize: 10, verbatimTail: 1 });
		const msgs = linear(30);
		const handlers: Handler[] = [addEp('early (m0-9)'), addEp('mid (m10-19)')];
		const db = realDb();
		await processChat(deps(db, scriptedLlm(handlers, db, chatId)), chatId, msgs, 'm29');
		expect(coverageOf(chatId, msgs, 'm29').cursorMessageId).toBe('m19');

		// Branch at m10 (archived zone): a SIBLING subtree under m9. The original m10..m29
		// stay in the tree, off the active path, which is what "create_branch" produces.
		const tree: MemoryMessage[] = [
			...msgs,
			{ id: 'm10b', parentId: 'm9', role: 'user', content: 'alt10', speaker: 'User' },
			{ id: 'm11b', parentId: 'm10b', role: 'assistant', content: 'alt11', speaker: 'Char' }
		];
		expect(await syncCoverage(deps(db, async () => ''), chatId, tree, 'm11b')).toEqual({ reaped: 0 });

		const c = coverageOf(chatId, tree, 'm11b');
		expect(c.cursorMessageId).toBe('m9');
		expect(c.active.length).toBe(1);
		expect(c.active[0].content).toBe('ep early (m0-9)');
		expect(c.dormant.length).toBe(1);
		// Both rows are still on disk, the whole point of dormancy.
		expect(serverDb.memListEpisodes(chatId).length).toBe(2);
		assertConsistent(chatId, tree, 'm11b');

		// And back: the deeper boundary returns from the same rows, no writes, no calls.
		expect(coverageOf(chatId, tree, 'm29').cursorMessageId).toBe('m19');
	});

	test('retry-replace then deep branch stays consistent (promotion + real SQL)', async () => {
		const chatId = await newChat({ batchSize: 2, verbatimTail: 1, maxPerLayer: 4, promoteCount: 2, maxLayers: 2 });
		const msgs = linear(25);
		const db = realDb();
		const handlers: Handler[] = Array.from({ length: 20 }, (_, k) => addEp(`${k}`));
		await processChat(deps(db, scriptedLlm(handlers, db, chatId)), chatId, msgs, 'm24');

		// Promotion must have happened via real SQL: a higher layer exists, each within cap.
		const eps = serverDb.memListEpisodes(chatId);
		const byLayer = new Map<number, number>();
		for (const e of eps) byLayer.set(e.layer, (byLayer.get(e.layer) ?? 0) + 1);
		expect(byLayer.get(1) ?? 0).toBeGreaterThan(0);
		for (const [, n] of byLayer) expect(n).toBeLessThanOrEqual(4);

		// Now a deep swipe at m6 (well inside the promoted/archived zone), a sibling, so the
		// original subtree survives off-path.
		const tree: MemoryMessage[] = [...msgs, { id: 'm6b', parentId: 'm5', role: 'assistant', content: 'alt', speaker: 'Char' }];
		expect(await syncCoverage(deps(db, async () => ''), chatId, tree, 'm6b')).toEqual({ reaped: 0 });
		assertConsistent(chatId, tree, 'm6b');
		// Nothing was thrown away, so the original timeline is intact.
		expect(serverDb.memListEpisodes(chatId).length).toBe(eps.length);
		assertConsistent(chatId, msgs, 'm24');
	});

	test('a pruned subtree DOES cost the summaries below it: the rows are gone', async () => {
		// The shape that legitimately destroys memory: every descendant deleted and the turn
		// itself rewritten (a subtree delete followed by an edit), so the turns those summaries
		// describe no longer exist anywhere in the chat. Dormancy cannot save what was deleted,
		// and pretending otherwise would leave summaries of text nobody can read.
		const chatId = await newChat({ batchSize: 10, verbatimTail: 1 });
		const msgs = linear(30);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('a'), addEp('b')], db, chatId)), chatId, msgs, 'm29');
		expect(serverDb.memListEpisodes(chatId).length).toBe(2);

		// Descendants of m10 pruned, m10 itself rewritten in place.
		const pruned = msgs.slice(0, 11).map((m) => (m.id === 'm10' ? { ...m, editedAt: Date.now() + 60_000 } : m));
		expect(await syncCoverage(deps(db, async () => ''), chatId, pruned, 'm10')).toEqual({ reaped: 1 });
		const c = coverageOf(chatId, pruned, 'm10');
		expect(c.cursorMessageId).toBe('m9');
		expect(c.active.length).toBe(1); // m0-9 is untouched and still applies
		assertConsistent(chatId, pruned, 'm10');
	});

	test('rebuild wipes derived rows but keeps the enabled state row', async () => {
		const chatId = await newChat({ batchSize: 10, verbatimTail: 10 });
		const msgs = linear(30);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('x')], db, chatId)), chatId, msgs, 'm29');
		expect(serverDb.memListEpisodes(chatId).length).toBeGreaterThan(0);

		await rebuildChat(deps(db, scriptedLlm([addEp('y')], db, chatId)), chatId, msgs, 'm29');
		const state = serverDb.memGetState(chatId);
		expect(state).not.toBe(null);
		expect(state.enabled).toBe(true);
		expect(state.cursorMessageId).toBeUndefined(); // the column is gone; the boundary derives
		expect(coverageOf(chatId, msgs, 'm29').cursorMessageId).toBe('m19');
		assertConsistent(chatId, msgs, 'm29');
	});

	test('the coverage guard rejects a second fold of the same turns, in real SQL', async () => {
		const chatId = await newChat({ batchSize: 5, verbatimTail: 1 });
		const msgs = linear(11);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('x')], db, chatId)), chatId, msgs, 'm10');
		const before = serverDb.memListEpisodes(chatId).length;
		expect(before).toBe(2);

		await expect(
			db.applyBatch(chatId, {
				episode: { content: 'stale', sourceMessageIds: ['m5', 'm6'], anchorMessageId: 'm6' },
				supersedeEpisodeIds: []
			})
		).rejects.toThrow('mem-op-superseded');
		// The transaction rolled back whole.
		expect(serverDb.memListEpisodes(chatId).length).toBe(before);
		assertConsistent(chatId, msgs, 'm10');
	});

	test('a batch may supersede the dormant summary it overlaps, in one transaction', async () => {
		const chatId = await newChat({ batchSize: 5, verbatimTail: 1 });
		const msgs = linear(11);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('x')], db, chatId)), chatId, msgs, 'm10');
		const [first] = serverDb.memListEpisodes(chatId);

		await db.applyBatch(chatId, {
			episode: { content: 'refolded', sourceMessageIds: ['m0', 'm1', 'm2', 'm3', 'm4'], anchorMessageId: 'm4' },
			supersedeEpisodeIds: [first.id]
		});
		const after = serverDb.memListEpisodes(chatId);
		expect(after.length).toBe(2);
		expect(after.some((e: any) => e.id === first.id)).toBe(false);
		expect(after.some((e: any) => e.content === 'refolded')).toBe(true);
		assertConsistent(chatId, msgs, 'm10');
	});

	test('edited-after-fold: a rewritten archived turn loses its summary and nothing else', async () => {
		const chatId = await newChat({ batchSize: 5, verbatimTail: 1 });
		const msgs = linear(11); // two batches: m0-4, m5-9
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('a'), addEp('b')], db, chatId)), chatId, msgs, 'm10');
		expect(coverageOf(chatId, msgs, 'm10').cursorMessageId).toBe('m9');

		// In-place rewrite of m7 (same id, same tree), stamped after both folds, the way
		// updateMessageContent stamps edited_at.
		const edited = msgs.map((m) => (m.id === 'm7' ? { ...m, editedAt: Date.now() + 60_000 } : m));
		expect(await syncCoverage(deps(db, async () => ''), chatId, edited, 'm10')).toEqual({ reaped: 1 });
		expect(serverDb.memListEpisodes(chatId).length).toBe(1);
		expect(coverageOf(chatId, edited, 'm10').cursorMessageId).toBe('m4');
		assertConsistent(chatId, edited, 'm10');
	});

	test('a minor edit records the touch and leaves the summary standing', async () => {
		const chatId = await newChat({ batchSize: 5, verbatimTail: 1 });
		const msgs = linear(11); // two batches: m0-4, m5-9
		// Real rows here, unlike the fixtures above: the two stamps live in SQL and the whole
		// question is which of them a save moves.
		const now = Date.now();
		msgs.forEach((m, i) =>
			serverDb.insertMessage({
				id: m.id,
				chatId,
				parentId: m.parentId,
				role: m.role,
				content: m.content,
				personaId: null,
				createdAt: now + i,
				siblingIndex: 0
			})
		);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('a'), addEp('b')], db, chatId)), chatId, msgs, 'm10');
		expect(coverageOf(chatId, msgs, 'm10').cursorMessageId).toBe('m9');
		const read = () =>
			(serverDb.getMessagesByChat(chatId) as MemoryMessage[]).map((m) => ({ ...m, speaker: '' }));

		serverDb.updateMessageContent('m7', 'turn 7, with the comma fixed', { minor: true });
		const tidied = read();
		const touched = tidied.find((m) => m.id === 'm7')!;
		expect(touched.content).toBe('turn 7, with the comma fixed');
		// The transcript can still say it was edited; memory's own stamp never moved.
		expect((touched as { minorEditedAt?: number | null }).minorEditedAt).toBeGreaterThan(0);
		expect(touched.editedAt ?? null).toBeNull();
		expect(await syncCoverage(deps(db, async () => ''), chatId, tidied, 'm10')).toEqual({ reaped: 0 });
		expect(coverageOf(chatId, tidied, 'm10').cursorMessageId).toBe('m9');

		// And an ordinary rewrite of the same turn still costs exactly what it always did.
		serverDb.updateMessageContent('m7', 'she said something else entirely');
		const rewritten = read();
		expect(await syncCoverage(deps(db, async () => ''), chatId, rewritten, 'm10')).toEqual({ reaped: 1 });
		expect(coverageOf(chatId, rewritten, 'm10').cursorMessageId).toBe('m4');
	});

	test('branch away and back, twice, never loses or double-counts anything', async () => {
		const chatId = await newChat({ batchSize: 10, verbatimTail: 10 });
		const msgs = linear(40); // batches m0-9 / m10-19 / m20-29, tail m30-39
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('x')], db, chatId)), chatId, msgs, 'm39');
		expect(coverageOf(chatId, msgs, 'm39').cursorMessageId).toBe('m29');
		const stored = serverDb.memListEpisodes(chatId).length;

		// Edit user turn m24 as a branch (clone + fresh reply), the user-reported shape.
		const branch: MemoryMessage[] = [
			...msgs,
			{ id: 'm24b', parentId: 'm23', role: 'user', content: 'alt 24', speaker: 'User' },
			{ id: 'm25b', parentId: 'm24b', role: 'assistant', content: 'alt reply', speaker: 'Char' }
		];

		for (let round = 0; round < 2; round++) {
			expect(await syncCoverage(deps(db, async () => ''), chatId, branch, 'm25b')).toEqual({ reaped: 0 });
			// The 26-long branch path forces the boundary out of the tail: past the straddling
			// m20-29 batch and a whole further batch back to m9.
			const onBranch = coverageOf(chatId, branch, 'm25b');
			expect(onBranch.cursorMessageId).toBe('m9');
			expect(onBranch.archivedIds.size).toBe(10);
			expect(onBranch.dormant.length).toBe(2);
			assertConsistent(chatId, branch, 'm25b');

			expect(await syncCoverage(deps(db, async () => ''), chatId, branch, 'm39')).toEqual({ reaped: 0 });
			const onMain = coverageOf(chatId, branch, 'm39');
			expect(onMain.cursorMessageId).toBe('m29');
			expect(onMain.dormant.length).toBe(0);
			assertConsistent(chatId, branch, 'm39');
		}
		// Two full round trips, not one row spent.
		expect(serverDb.memListEpisodes(chatId).length).toBe(stored);
	});

	test('promotion supersede guard: merging already-consumed episodes is rejected', async () => {
		const chatId = await newChat({});
		await expect(
			realDb().applyPromotion(chatId, {
				insert: { layer: 1, content: 'x', sourceMessageIds: [], anchorMessageId: null },
				deleteEpisodeIds: ['nope']
			})
		).rejects.toThrow('mem-op-superseded');
	});

	test('reaping is idempotent and needs no boundary to guard', async () => {
		const chatId = await newChat({ batchSize: 5, verbatimTail: 1 });
		const msgs = linear(11);
		const db = realDb();
		await processChat(deps(db, scriptedLlm([addEp('a'), addEp('b')], db, chatId)), chatId, msgs, 'm10');
		const [first] = serverDb.memListEpisodes(chatId);

		await db.reapEpisodes(chatId, [first.id]);
		await db.reapEpisodes(chatId, [first.id]); // again: a no-op, not an error
		await db.reapEpisodes(chatId, []);
		expect(serverDb.memListEpisodes(chatId).length).toBe(1);
		assertConsistent(chatId, msgs, 'm10');
	});
});
