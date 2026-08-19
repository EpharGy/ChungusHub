/**
 * Reading a picked folder into one bundle of SillyTavern files.
 *
 * **The pick is the profile folder** (`data/default-user` in a standard install), and a known
 * folder counts only as a direct child of it. An ancestor therefore matches nothing and is
 * refused, which is the whole rule. Resolving an ancestor for the reader is not free and must
 * not come back: `<input webkitdirectory>` makes the BROWSER walk every file under the pick
 * before a line of this runs, so pointing at a SillyTavern checkout costs its entire
 * `node_modules` whatever we then do with the list.
 *
 * Pure path arithmetic and File objects: no stores, no db, no writes, and tested as such
 * ([`sillyTavernFolderScan.test.ts`](./sillyTavernFolderScan.test.ts)). What is done with the
 * result belongs to `sillyTavernFolderImport.ts`.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const KNOWN_FOLDERS = ['backgrounds', 'characters', 'worlds', 'chats', 'User Avatars'] as const;
type KnownFolder = (typeof KNOWN_FOLDERS)[number];

/** One row of the import ledger: a source file an earlier run claimed, and what it became for
 *  the one kind a later run has to find again (a character card's library entry). */
export interface ImportedSource {
	key: string;
	entityId: string | null;
}

/** One profile folder's worth of files, ready to import. */
export interface FolderScan {
	/** The picked folder's own name, so the confirm card can say what it read. */
	root: string;
	characters: File[];
	/** Sprite folder name → its images. Grouped here so a pack lands as one write, and so the
	 *  count is on screen before the import runs. */
	spritesByFolder: Map<string, File[]>;
	worlds: File[];
	backgrounds: File[];
	avatars: File[];
	chats: { file: File; characterName: string }[];
	/** The profile's `settings.json`, which is where the persona names live. */
	settingsFile: File | null;
}

/**
 * Is this path a file inside one of SillyTavern's folders, one level under the pick?
 *
 * The browser prefixes every path with the picked folder's own name, so the folder has to be
 * the SECOND segment and can be nowhere else: deeper refuses an ancestor, and shallower would
 * accept a lone `characters/` folder as a profile, which is a different pick with no
 * `settings.json`, no chats and no way to spell any of that on screen.
 */
function isInKnownFolder(parts: string[]): boolean {
	return parts.length > 2 && (KNOWN_FOLDERS as readonly string[]).includes(parts[1]);
}

/**
 * File a path into its bucket.
 *
 * backgrounds / characters / worlds / User Avatars are flat in SillyTavern, so only direct
 * children count. A `characters/<Name>/` sub-folder is that character's sprites (anger.png,
 * joy.png, …) rather than a card, so it is bucketed separately and never mistaken for one.
 */
function place(scan: FolderScan, folder: KnownFolder, rest: string[], file: File): void {
	const direct = rest.length === 1;
	if (folder === 'backgrounds' && direct && IMAGE_EXT.test(file.name)) scan.backgrounds.push(file);
	else if (folder === 'characters' && direct && /\.(png|json)$/i.test(file.name)) scan.characters.push(file);
	else if (folder === 'characters' && rest.length === 2 && IMAGE_EXT.test(file.name)) {
		// characters/<characterName>/<label>.png: the filename IS the label.
		const bucket = scan.spritesByFolder.get(rest[0]);
		if (bucket) bucket.push(file);
		else scan.spritesByFolder.set(rest[0], [file]);
	} else if (folder === 'worlds' && direct && /\.json$/i.test(file.name)) scan.worlds.push(file);
	else if (folder === 'User Avatars' && direct && IMAGE_EXT.test(file.name)) scan.avatars.push(file);
	else if (folder === 'chats' && /\.jsonl$/i.test(file.name) && rest.length >= 2) {
		// chats/<characterName>/<file>.jsonl: the folder names the character.
		scan.chats.push({ file, characterName: rest[0] });
	}
}

/**
 * Read a picked profile folder. Returns **null** when nothing recognizable is directly inside
 * it, never an empty bundle: importing nothing under a success message is how somebody decides
 * the app cannot read their library.
 */
export function scanSillyTavernFolder(files: File[]): FolderScan | null {
	const scan: FolderScan = {
		root: '',
		characters: [],
		spritesByFolder: new Map(),
		worlds: [],
		backgrounds: [],
		avatars: [],
		chats: [],
		settingsFile: null
	};

	for (const file of files) {
		const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);

		// The profile's own settings.json, beside those folders and never deeper.
		if (parts[parts.length - 1] === 'settings.json') {
			if (parts.length <= 2 && !scan.settingsFile) scan.settingsFile = file;
			continue;
		}

		if (!isInKnownFolder(parts)) continue;
		scan.root = parts[0];
		place(scan, parts[1] as KnownFolder, parts.slice(2), file);
	}

	return countFiles(scan) > 0 ? scan : null;
}

/** How many files a bundle would import. Sprites count one by one, since each is its own
 *  source file even though a pack lands as one write. */
export function countFiles(scan: FolderScan): number {
	let sprites = 0;
	for (const files of scan.spritesByFolder.values()) sprites += files.length;
	return (
		scan.characters.length +
		sprites +
		scan.worlds.length +
		scan.backgrounds.length +
		scan.avatars.length +
		scan.chats.length
	);
}

/**
 * What a file is called in the import ledger (`import_sources`, architecture/server-core.md).
 *
 * The path INSIDE the picked folder, so the same library recognizes itself after being copied
 * or renamed, namespaced by the format so a second importer can never collide with this one.
 * A path and not a hash: a card edited in SillyTavern is that character arriving twice, and a
 * key that moved with every edit would protect nobody.
 */
export function sourceKey(root: string, file: File): string {
	const path = file.webkitRelativePath || file.name;
	const inside = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
	return `sillytavern:${inside}`;
}

/**
 * The card filename's stem, for a key that names a character card, else null.
 *
 * This is what lets a LATER run bind a chat folder to a character the ledger already holds:
 * the folder is named after the card's file, and matching on display name instead is the exact
 * collision that filename matching exists to avoid. A sprite (`characters/<Name>/joy.png`) is
 * not a card, so the single segment under `characters/` is required rather than assumed.
 */
export function cardStemFromKey(key: string): string | null {
	const parts = key.replace(/^sillytavern:/, '').split('/');
	if (parts.length !== 2 || parts[0] !== 'characters') return null;
	return parts[1].replace(/\.[^.]+$/, '').toLowerCase();
}

/**
 * The same bundle with everything already imported taken out. Sprite folders left empty by the
 * filter are dropped whole, so a character whose pack is entirely known is not visited at all.
 */
export function withoutImported(scan: FolderScan, known: Set<string>): FolderScan {
	const fresh = (file: File) => !known.has(sourceKey(scan.root, file));
	const spritesByFolder = new Map<string, File[]>();
	for (const [folder, files] of scan.spritesByFolder) {
		const kept = files.filter(fresh);
		if (kept.length > 0) spritesByFolder.set(folder, kept);
	}
	return {
		root: scan.root,
		characters: scan.characters.filter(fresh),
		spritesByFolder,
		worlds: scan.worlds.filter(fresh),
		backgrounds: scan.backgrounds.filter(fresh),
		avatars: scan.avatars.filter(fresh),
		chats: scan.chats.filter((c) => fresh(c.file)),
		// The profile's settings.json is not a library item and is never claimed: it is read for
		// the persona names beside it, and a run that imports one new persona still needs it.
		settingsFile: scan.settingsFile
	};
}
