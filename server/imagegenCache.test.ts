/**
 * The generated-image cache sweep, against the REAL server database and real files on disk.
 *
 * This is the one sweep in the app that deletes a picture a row still points at, so what it
 * refuses to touch matters more than what it takes. Four rules are pinned here and every one
 * of them is a way the feature could quietly eat something it should not have:
 *
 *  1. A picture the READER attached is never touched, and never counted either. Sizing the
 *     budget against the whole folder while deleting only the generated half would delete
 *     every generated picture and still report itself over budget.
 *  2. A file two turns name (a branch, a fork) survives until both let go.
 *  3. Nothing inside the grace window goes, whatever the budget says.
 *  4. A budget of 0 is "no budget" and takes nothing.
 *
 * Same env dance as messageSpriteLabel.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway
 * dir before the first db call, so no test can write into the real user-data.
 *
 * The pictures, though, go wherever `IMAGES_ROOT` already points, and NOT under this file's
 * own temp dir. That const is resolved once when server/config.ts is first imported, so in
 * a whole-suite run it belongs to whichever test file got there first, while the database
 * handle rebinds per file because `resolveDbPath` is a function. Writing to the dir this
 * file made would put the files somewhere `deleteImage` cannot reach, and the sweep would
 * report deletions that never happened. Following the const instead keeps "found it" and
 * "deleted it" talking about one file, which is the property under test. The guard below
 * is what makes that safe to rely on.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

let dataDir: string;
let chatImagesDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-imagegen-cache-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	// One handle per process, bound on first use (see server/db.ts). Release whatever an
	// earlier file left open so this file's first db call binds to the dir above.
	serverDb.closeForTests();

	const { IMAGES_ROOT } = await import('./config');
	chatImagesDir = join(IMAGES_ROOT, 'chat');
	// This file writes and deletes real picture files, so it refuses to run at all unless
	// the root it is about to write into is a throwaway. Every server test pins
	// CHUNGUS_DATA_DIR before importing, so this holds; if one ever stops, the suite fails
	// here instead of deleting somebody's pictures.
	const underTmp = resolve(chatImagesDir).startsWith(resolve(tmpdir()) + sep);
	expect(underTmp, `refusing to write pictures outside a temp dir: ${chatImagesDir}`).toBe(true);
	mkdirSync(chatImagesDir, { recursive: true });
});

afterAll(() => {
	serverDb.closeForTests();
	// The pictures may sit in another test file's temp dir (see the note above), so only
	// the ones this file wrote are removed, by the prefix it wrote them under.
	try {
		for (const name of readdirSync(chatImagesDir)) {
			if (name.startsWith('pic-')) rmSync(join(chatImagesDir, name), { force: true });
		}
	} catch {
		/* best effort */
	}
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;

let clock = 1_700_000_000_000;
let seq = 0;

/** A file of exactly `bytes` under images/chat/, and the path a row would name it by. */
function writePicture(bytes: number): string {
	const name = `pic-${seq++}.png`;
	writeFileSync(join(chatImagesDir, name), Buffer.alloc(bytes, 1));
	return `images/chat/${name}`;
}

/** One assistant turn carrying the attachments given. */
function makeTurn(attachments: unknown[]): string {
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
		content: 'She smiled. [[IMG: a smile | PORTRAIT | CLOSE | RANDOM ]]',
		createdAt: clock++,
		siblingIndex: 0
	});
	serverDb.updateMessageAttachments(messageId, attachments);
	return messageId;
}

/** A generated picture as the engine files one: the flag is what marks it disposable. */
function generated(path: string, ageMs: number, marker = 0) {
	return { kind: 'image', path, generated: { marker, prompt: 'a smile', seed: 1, createdAt: Date.now() - ageMs } };
}

/** A picture the reader attached. No `generated` block, so no sweep may reach it. */
function attached(path: string) {
	return { kind: 'image', path };
}

const attachmentsOf = (id: string): any[] => serverDb.getMessage(id).attachments ?? [];
const onDisk = (path: string): boolean =>
	existsSync(join(chatImagesDir, path.slice('images/chat/'.length)));

beforeEach(() => {
	// Each test starts from an empty table: the sweep is whole-table by nature, so a turn
	// left behind by an earlier test is another test's budget.
	for (const chat of serverDb.getAllChats() as { id: string }[]) serverDb.deleteChat(chat.id);
	// The budget is read from this row by the boot pass, so a value one test left behind is
	// another test's policy.
	serverDb.deleteSetting('imagegen');
});

describe('what the sweep counts', () => {
	test('a picture the reader attached is neither counted nor taken', () => {
		makeTurn([attached(writePicture(4 * MB))]);
		const generatedPath = writePicture(1 * MB);
		makeTurn([generated(generatedPath, 3 * HOUR)]);

		// 5 MB sits in images/chat/, but only 1 MB of it is this engine's.
		const report = serverDb.imagegenCacheReport(0);
		expect(report.totalFiles).toBe(1);
		expect(report.totalBytes).toBe(1 * MB);

		// A budget under the folder's size but over the generated half takes nothing. Were
		// the upload counted, this would delete the only picture it is allowed to touch and
		// still be over budget afterwards.
		const swept = serverDb.sweepGeneratedImageCache(2 * MB);
		expect(swept.files).toBe(0);
		expect(onDisk(generatedPath)).toBe(true);
	});

	test('a budget of 0 means no budget and takes nothing', () => {
		const path = writePicture(8 * MB);
		makeTurn([generated(path, 5 * HOUR)]);

		const report = serverDb.sweepGeneratedImageCache(0);
		expect(report.totalFiles).toBe(1);
		expect(report.files).toBe(0);
		expect(onDisk(path)).toBe(true);
	});

	test('a file two turns name is counted once, not twice', () => {
		// What a branch or a fork produces: the attachment list is COPIED, so one picture is
		// named by two rows. Counting references would report 4 MB and free 2.
		const shared = writePicture(2 * MB);
		makeTurn([generated(shared, 5 * HOUR)]);
		makeTurn([generated(shared, 5 * HOUR)]);

		expect(serverDb.imagegenCacheReport(0).totalBytes).toBe(2 * MB);
	});
});

describe('what the sweep takes', () => {
	test('the oldest go first, and only as many as the budget needs', () => {
		const oldest = writePicture(2 * MB);
		const middle = writePicture(2 * MB);
		const newest = writePicture(2 * MB);
		makeTurn([generated(oldest, 10 * HOUR)]);
		makeTurn([generated(middle, 5 * HOUR)]);
		makeTurn([generated(newest, 2 * HOUR)]);

		const report = serverDb.sweepGeneratedImageCache(4 * MB);
		expect(report.files).toBe(1);
		expect(report.bytes).toBe(2 * MB);
		expect(onDisk(oldest)).toBe(false);
		expect(onDisk(middle)).toBe(true);
		expect(onDisk(newest)).toBe(true);
	});

	test('the row stops naming what went, so the marker gets its button back', () => {
		const path = writePicture(4 * MB);
		const messageId = makeTurn([generated(path, 10 * HOUR)]);

		serverDb.sweepGeneratedImageCache(1 * MB);
		// An empty list is stored as NULL, the shape a turn that never had one wears.
		expect(attachmentsOf(messageId)).toEqual([]);
	});

	test('an upload on the same turn survives the generated picture beside it', () => {
		const kept = writePicture(1 * MB);
		const taken = writePicture(4 * MB);
		const messageId = makeTurn([attached(kept), generated(taken, 10 * HOUR)]);

		serverDb.sweepGeneratedImageCache(1 * MB);
		expect(attachmentsOf(messageId)).toEqual([{ kind: 'image', path: kept }]);
		expect(onDisk(kept)).toBe(true);
		expect(onDisk(taken)).toBe(false);
	});

	test('a shared file leaves disk only once BOTH turns have let go of it', () => {
		// What a branch or a fork leaves behind: one picture, two rows. Taking it means
		// rewriting both, and the reference count - asked AFTER the write, as everywhere
		// else here - is what allows the delete. Both markers get their button back, which
		// is right: it is the same picture at the same age in both places.
		const shared = writePicture(4 * MB);
		const first = makeTurn([generated(shared, 10 * HOUR)]);
		const second = makeTurn([generated(shared, 10 * HOUR)]);
		expect(attachmentsOf(second).length).toBe(1);

		serverDb.sweepGeneratedImageCache(1 * MB);
		expect(attachmentsOf(first)).toEqual([]);
		expect(attachmentsOf(second)).toEqual([]);
		expect(onDisk(shared)).toBe(false);
	});

	test('a picture only ONE of two turns lets go of stays on disk', () => {
		// The half-shared case, and the one that would corrupt a fork if the count were
		// skipped: the sweep rewrites the row it planned against, the other row still names
		// the file, so the file stays and that fork still draws its picture.
		const shared = writePicture(4 * MB);
		const swept = makeTurn([generated(shared, 10 * HOUR)]);
		const holder = makeTurn([generated(shared, 10 * HOUR)]);

		// Put the second row out of the sweep's reach without changing what it names: the
		// plan is built from `generated` attachments, so an upload naming the same file is
		// invisible to it and stands in for any row the sweep did not rewrite.
		serverDb.updateMessageAttachments(holder, [attached(shared)]);

		serverDb.sweepGeneratedImageCache(1 * MB);
		expect(attachmentsOf(swept)).toEqual([]);
		expect(attachmentsOf(holder)).toEqual([{ kind: 'image', path: shared }]);
		expect(onDisk(shared)).toBe(true);
	});
});

describe('the boot pass reads the budget from settings', () => {
	// Its whole failure mode is silence: a parse that does not match what the page writes
	// returns "no budget", which looks exactly like a reader who never set one. These pin
	// the read itself rather than the sweep, which the tests above already cover.

	test('sweeps to the budget the settings row names', () => {
		const old = writePicture(8 * MB);
		makeTurn([generated(old, 10 * HOUR)]);
		// The shape the page actually writes: the whole settings object, JSON-stringified
		// under one key (syncedSetting.ts).
		serverDb.setSetting('imagegen', JSON.stringify({ enabled: true, cacheLimitMb: 1 }));

		const report = serverDb.sweepGeneratedImageCacheToBudget();
		expect(report?.files).toBe(1);
		expect(onDisk(old)).toBe(false);
	});

	test('does nothing when the budget is 0, missing, or unreadable', () => {
		const kept = writePicture(8 * MB);
		makeTurn([generated(kept, 10 * HOUR)]);

		serverDb.setSetting('imagegen', JSON.stringify({ cacheLimitMb: 0 }));
		expect(serverDb.sweepGeneratedImageCacheToBudget()).toBeNull();

		serverDb.setSetting('imagegen', JSON.stringify({ enabled: true }));
		expect(serverDb.sweepGeneratedImageCacheToBudget()).toBeNull();

		serverDb.setSetting('imagegen', 'not json at all');
		expect(serverDb.sweepGeneratedImageCacheToBudget()).toBeNull();

		serverDb.deleteSetting('imagegen');
		expect(serverDb.sweepGeneratedImageCacheToBudget()).toBeNull();

		// Every one of those failed towards keeping the picture.
		expect(onDisk(kept)).toBe(true);
	});

	test('a restart does not reprieve a picture: grace is its stored age, not uptime', () => {
		// The question this answers: a picture generated 50 minutes before a restart is still
		// inside its grace window afterwards, and still sweepable once an hour has passed.
		// Nothing about the window lives in the process, so there is nothing for a restart
		// to reset - the same row, read again, simply gives a different answer later.
		const path = writePicture(8 * MB);
		const messageId = makeTurn([generated(path, 50 * 60 * 1000)]);
		serverDb.setSetting('imagegen', JSON.stringify({ cacheLimitMb: 1 }));

		expect(serverDb.sweepGeneratedImageCacheToBudget()?.files).toBe(0);
		expect(onDisk(path)).toBe(true);

		// The same picture, restamped as 70 minutes old, is taken by an identical call.
		serverDb.updateMessageAttachments(messageId, [generated(path, 70 * 60 * 1000)]);
		expect(serverDb.sweepGeneratedImageCacheToBudget()?.files).toBe(1);
		expect(onDisk(path)).toBe(false);
	});
});

describe('the grace window', () => {
	test('nothing generated in the last hour goes, whatever the budget says', () => {
		const fresh = writePicture(8 * MB);
		makeTurn([generated(fresh, 5 * 60 * 1000)]);

		const report = serverDb.sweepGeneratedImageCache(1 * MB);
		expect(report.files).toBe(0);
		expect(onDisk(fresh)).toBe(true);
	});

	test('a budget it cannot reach without the last hour is left unmet, not forced', () => {
		// Everything old goes and the cache is STILL over budget, because what is left is
		// inside the grace window. The reader keeps this evening's pictures and the number
		// waits until they age; the alternative is a small budget deleting a reply out from
		// under someone mid-read.
		const fresh = writePicture(4 * MB);
		const old = writePicture(4 * MB);
		makeTurn([generated(fresh, 1 * 60 * 1000)]);
		makeTurn([generated(old, 10 * HOUR)]);

		const report = serverDb.sweepGeneratedImageCache(1 * MB);
		expect(report.files).toBe(1);
		expect(onDisk(old)).toBe(false);
		expect(onDisk(fresh)).toBe(true);
		// Still 4 MB against a 1 MB budget, and the next sweep will say the same until the
		// picture is an hour old. A sweep that reported "done" here would be lying.
		expect(serverDb.imagegenCacheReport(1 * MB).totalBytes).toBe(4 * MB);
	});
});
