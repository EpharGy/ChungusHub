import { describe, it, expect } from 'bun:test';
import {
	cardStemFromKey,
	countFiles,
	scanSillyTavernFolder,
	sourceKey,
	withoutImported
} from './sillyTavernFolderScan';

/** A picked file, spelled the way the browser hands one over: a flat list, each entry carrying
 *  its path relative to the folder that was chosen, that folder's own name included. */
function pick(paths: string[]): File[] {
	return paths.map((path) => {
		const file = new File(['x'], path.split('/').pop() as string);
		Object.defineProperty(file, 'webkitRelativePath', { value: path });
		return file;
	});
}

/** The profile folder, which is the one thing this reads. */
const PROFILE = [
	'default-user/settings.json',
	'default-user/characters/Alice.png',
	'default-user/characters/Bob.json',
	'default-user/characters/Alice/joy.png',
	'default-user/characters/Alice/anger.png',
	'default-user/worlds/Kingdom.json',
	'default-user/backgrounds/tavern.jpg',
	'default-user/User Avatars/me.png',
	'default-user/chats/Alice/2026-01-01.jsonl',
	'default-user/backups/chat_Alice_2026.jsonl'
];

describe('scanSillyTavernFolder', () => {
	it('reads the profile folder it was pointed at', () => {
		const scan = scanSillyTavernFolder(pick(PROFILE));
		expect(scan).not.toBeNull();
		expect(scan!.root).toBe('default-user');
		expect(scan!.characters.map((f) => f.name).sort()).toEqual(['Alice.png', 'Bob.json']);
		expect(scan!.spritesByFolder.get('Alice')?.length).toBe(2);
		expect(scan!.worlds.map((f) => f.name)).toEqual(['Kingdom.json']);
		expect(scan!.backgrounds.length).toBe(1);
		expect(scan!.avatars.length).toBe(1);
		expect(scan!.chats.map((c) => c.characterName)).toEqual(['Alice']);
		expect(scan!.settingsFile?.name).toBe('settings.json');
	});

	it('takes chat backups for what they are, not for chats', () => {
		expect(scanSillyTavernFolder(pick(PROFILE))!.chats.length).toBe(1);
	});

	it('refuses an ancestor rather than going looking inside it', () => {
		const checkout = [
			'SillyTavern/package.json',
			'SillyTavern/node_modules/sharp/characters/thing.png',
			'SillyTavern/default/content/characters/Seraphina.png',
			...PROFILE.map((p) => `SillyTavern/data/${p}`)
		];
		expect(scanSillyTavernFolder(pick(checkout))).toBeNull();
		expect(scanSillyTavernFolder(pick(PROFILE.map((p) => `data/${p}`)))).toBeNull();
	});

	it('refuses one known folder picked on its own, which is not a profile', () => {
		expect(scanSillyTavernFolder(pick(['characters/Alice.png', 'characters/Bob.json']))).toBeNull();
	});

	it('reads a known name as a folder on the way, never as the file itself', () => {
		const scan = scanSillyTavernFolder(pick(['Lib/worlds/chats', 'Lib/characters/Alice.png']));
		expect(scan!.worlds.length).toBe(0);
		expect(scan!.chats.length).toBe(0);
		expect(scan!.characters.length).toBe(1);
	});

	it('answers null rather than an empty import when nothing is recognizable', () => {
		expect(scanSillyTavernFolder(pick(['Downloads/holiday.png', 'Downloads/notes.txt']))).toBeNull();
	});
});

describe('the import ledger', () => {
	it('names a file by its path inside the pick, so a renamed copy is the same library', () => {
		const scan = scanSillyTavernFolder(pick(PROFILE))!;
		expect(sourceKey(scan.root, scan.characters[0])).toBe('sillytavern:characters/Alice.png');

		const moved = scanSillyTavernFolder(
			pick(PROFILE.map((p) => p.replace('default-user/', 'ST-backup/')))
		)!;
		expect(sourceKey(moved.root, moved.characters[0])).toBe('sillytavern:characters/Alice.png');
	});

	it('takes out what has come over before, sprite by sprite', () => {
		const scan = scanSillyTavernFolder(pick(PROFILE))!;
		expect(countFiles(scan)).toBe(8);

		const fresh = withoutImported(
			scan,
			new Set([
				'sillytavern:characters/Alice.png',
				'sillytavern:characters/Alice/joy.png',
				'sillytavern:chats/Alice/2026-01-01.jsonl'
			])
		);
		expect(fresh.characters.map((f) => f.name)).toEqual(['Bob.json']);
		expect(fresh.spritesByFolder.get('Alice')?.map((f) => f.name)).toEqual(['anger.png']);
		expect(fresh.chats.length).toBe(0);
		expect(countFiles(fresh)).toBe(5);
		// The persona names are read from it on every run, so it is never claimed or filtered.
		expect(fresh.settingsFile).toBe(scan.settingsFile);
	});

	it('drops a sprite folder whose whole pack is already here', () => {
		const scan = scanSillyTavernFolder(pick(PROFILE))!;
		const fresh = withoutImported(
			scan,
			new Set(['sillytavern:characters/Alice/joy.png', 'sillytavern:characters/Alice/anger.png'])
		);
		expect(fresh.spritesByFolder.size).toBe(0);
	});

	it('leaves everything standing when the ledger is empty', () => {
		const scan = scanSillyTavernFolder(pick(PROFILE))!;
		expect(countFiles(withoutImported(scan, new Set()))).toBe(countFiles(scan));
	});

	// What a later run binds this folder's chats and sprites with: the card's own filename,
	// never the character's display name, which collides on SillyTavern's Jason / Jason_1 pairs.
	it('reads a card key back as its filename stem, and nothing else as one', () => {
		expect(cardStemFromKey('sillytavern:characters/Jason_1.png')).toBe('jason_1');
		expect(cardStemFromKey('sillytavern:characters/Bob.json')).toBe('bob');
		expect(cardStemFromKey('sillytavern:characters/Jason/joy.png')).toBeNull();
		expect(cardStemFromKey('sillytavern:chats/Jason/2026.jsonl')).toBeNull();
		expect(cardStemFromKey('sillytavern:backgrounds/tavern.jpg')).toBeNull();
	});
});
