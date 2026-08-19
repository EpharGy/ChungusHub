/**
 * The persona floor, against the REAL server database (bun:sqlite): the library always holds
 * at least one persona, and `activePersonaId` always names a row that still exists.
 *
 * Both halves live inside `deleteLibraryEntry` because that is the one door every delete goes
 * through (the client's RPC bridge and the assistant's `delete_entity` alike), so these drive
 * the method directly rather than either caller. What they protect is a silent failure: with
 * no persona left, `{{user}}` falls back to a name nobody wrote and every chat is played by a
 * protagonist the reader never created.
 *
 * Same env dance as chatList.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway dir before the
 * first db call, so no test can silently write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-persona-'));
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

function makeEntry(type: 'character' | 'persona', name: string): string {
	const id = crypto.randomUUID();
	serverDb.insertLibraryEntry({
		id,
		type,
		identity: { name, tags: [] },
		data: { traits: { description: `${name} is here.` } },
		isFavorite: false,
		createdAt: (clock += 1000),
		updatedAt: clock
	});
	return id;
}

function personaIds(): string[] {
	return (serverDb.getAllLibraryEntries() as { id: string; type: string }[])
		.filter((entry) => entry.type === 'persona')
		.map((entry) => entry.id);
}

function exists(id: string): boolean {
	return serverDb.getLibraryEntry(id) !== null;
}

/**
 * Clear the library and hand back the one persona that cannot be cleared. The rule under test
 * is exactly why this is not a plain wipe: nothing can empty a library of personas, so the
 * reset takes it down to one and creates that one on the first run. Every test below builds
 * its own cast around that incumbent, so the file needs no shared ordering.
 */
function resetLibrary(): string {
	for (const entry of serverDb.getAllLibraryEntries() as { id: string; type: string }[]) {
		if (entry.type !== 'persona') serverDb.deleteLibraryEntry(entry.id);
	}
	for (const id of personaIds().slice(1)) serverDb.deleteLibraryEntry(id);
	serverDb.deleteSetting('activePersonaId');
	return personaIds()[0] ?? makeEntry('persona', 'Incumbent');
}

describe('the last persona cannot be deleted', () => {
	test('the only persona survives its own delete', () => {
		const only = resetLibrary();
		expect(() => serverDb.deleteLibraryEntry(only)).toThrow(/at least one persona/);
		expect(exists(only)).toBe(true);
	});

	test('a refusal leaves the active pointer alone', () => {
		const only = resetLibrary();
		serverDb.setSetting('activePersonaId', only);
		expect(() => serverDb.deleteLibraryEntry(only)).toThrow();
		expect(serverDb.getSetting('activePersonaId')).toBe(only);
	});

	test('a library full of characters is not cover for the last persona', () => {
		const only = resetLibrary();
		makeEntry('character', 'Aria');
		makeEntry('character', 'Vex');
		expect(() => serverDb.deleteLibraryEntry(only)).toThrow(/at least one persona/);
	});

	test('deleting down to one works, and stops there', () => {
		const incumbent = resetLibrary();
		const second = makeEntry('persona', 'Rival');
		serverDb.deleteLibraryEntry(second);
		expect(personaIds()).toEqual([incumbent]);
		expect(() => serverDb.deleteLibraryEntry(incumbent)).toThrow();
	});

	test('characters carry no floor: the only entry in the library goes', () => {
		resetLibrary();
		const character = makeEntry('character', 'Aria');
		expect(serverDb.deleteLibraryEntry(character)).toBeNull();
		expect(exists(character)).toBe(false);
	});
});

describe('the active persona always names a row that exists', () => {
	test('deleting the active one hands the role to a survivor', () => {
		const active = resetLibrary();
		const survivor = makeEntry('persona', 'Rival');
		serverDb.setSetting('activePersonaId', active);

		expect(serverDb.deleteLibraryEntry(active)).toBe(survivor);
		expect(serverDb.getSetting('activePersonaId')).toBe(survivor);
		expect(exists(active)).toBe(false);
	});

	test('the successor is the most recently touched survivor', () => {
		const active = resetLibrary();
		makeEntry('persona', 'Older');
		const newest = makeEntry('persona', 'Newest');
		serverDb.setSetting('activePersonaId', active);

		expect(serverDb.deleteLibraryEntry(active)).toBe(newest);
	});

	test('deleting a persona nobody is playing moves nothing', () => {
		const active = resetLibrary();
		const spare = makeEntry('persona', 'Rival');
		serverDb.setSetting('activePersonaId', active);

		expect(serverDb.deleteLibraryEntry(spare)).toBeNull();
		expect(serverDb.getSetting('activePersonaId')).toBe(active);
	});

	test('deleting a character never touches the pointer', () => {
		const active = resetLibrary();
		const character = makeEntry('character', 'Aria');
		serverDb.setSetting('activePersonaId', active);

		expect(serverDb.deleteLibraryEntry(character)).toBeNull();
		expect(serverDb.getSetting('activePersonaId')).toBe(active);
	});
});
