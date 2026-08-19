/**
 * SillyTavern character card export.
 *
 * Produces a SillyTavern V2 character card (`chara_card_v2`) as either a `.json` file or a
 * `.png` with the card embedded in a `chara` tEXt chunk, the same shape the importer
 * (`sillyTavernImport.ts`) reads. ChungusHub-native fidelity (all character versions, trait
 * labels, hidden traits, the ChungusHub-only `background` trait) rides in
 * `data.extensions.chungushub`, which SillyTavern ignores: a card reads as one clean
 * character in SillyTavern while round-tripping losslessly back into ChungusHub.
 *
 * The "which version" choice only decides the card's *surface*: 'all' shows the active
 * version in the standard fields and embeds every version; a specific id shows just that
 * version and embeds only it.
 */

import type { CharacterSprite, CharacterVersion, LibraryEntry, LibraryEntryData } from '$lib/types/library';
import {
	fetchImageBlob,
	makePlaceholderPng,
	reencodeToPng,
	sanitizeFilename,
	triggerDownload
} from '$lib/services/libraryExport';
import type { ExportedLibraryEntry } from '$lib/services/libraryExport';
import { buildTextChunk, encodeBase64Utf8, insertTextChunk } from '$lib/services/pngText';
import { createZip, type ZipEntry } from '$lib/services/zip';

/** 'all' surfaces the active version and embeds every version; a version id surfaces just that one. */
export type VersionSelection = 'all' | string;

/** The two SillyTavern card containers we write. */
export type ExportFormat = 'png' | 'json';

/** One character to export, paired with its versions (empty when unversioned). */
export interface ExportTarget {
	entry: LibraryEntry;
	versions: CharacterVersion[];
}

interface SillyTavernCardData {
	name: string;
	description: string;
	personality: string;
	scenario: string;
	first_mes: string;
	mes_example: string;
	creator: string;
	creator_notes: string;
	system_prompt: string;
	post_history_instructions: string;
	character_version: string;
	tags: string[];
	alternate_greetings: string[];
	extensions: { chungushub: ExportedLibraryEntry };
}

export interface SillyTavernCard {
	spec: 'chara_card_v2';
	spec_version: '2.0';
	/** The V1 card field set, mirrored at the top level so V1-only readers still see the
	 *  character; V2 readers use `data`, which is canonical. Real ST cards mirror the same set. */
	name: string;
	description: string;
	personality: string;
	scenario: string;
	first_mes: string;
	mes_example: string;
	data: SillyTavernCardData;
}

/** The version whose content fills the standard card fields. 'all' → the active version. */
function resolveSurfaceData(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection
): LibraryEntryData {
	if (selection === 'all') return entry.data;
	const picked = versions.find((v) => v.id === selection);
	return picked ? picked.data : entry.data;
}

/** Map a version's content onto the standard SillyTavern card fields. `background` has no ST
 *  slot, so it survives only in the embedded block. */
function traitsToCardFields(data: LibraryEntryData) {
	const t = data.traits;
	return {
		description: t.description ?? '',
		personality: t.personality ?? '',
		scenario: t.scenario ?? '',
		first_mes: t.firstMessage ?? '',
		mes_example: t.exampleDialogue ?? '',
		creator: t.creator ?? '',
		creator_notes: t.creatorNotes ?? '',
		system_prompt: t.systemPrompt ?? '',
		post_history_instructions: t.postHistoryInstructions ?? '',
		character_version: t.characterVersion ?? '',
		alternate_greetings: data.alternateGreetings ? [...data.alternateGreetings] : []
	};
}

/** Build the ChungusHub-native fidelity block embedded in a card's `data.extensions.chungushub`.
 *  Always carries the surfaced version's full data (so trait labels/hidden traits survive); the
 *  whole version list rides along only for an 'all' export. */
function buildExportBlock(
	entry: LibraryEntry,
	surfaceData: LibraryEntryData,
	versions: CharacterVersion[],
	includeAllVersions: boolean
): ExportedLibraryEntry {
	const withVersions = includeAllVersions && !!entry.activeVersionId && versions.length > 0;
	return {
		format: 'chungushub.libraryEntry',
		version: 2,
		type: entry.type,
		identity: {
			name: entry.identity.name,
			tags: entry.identity.tags ? [...entry.identity.tags] : []
		},
		data: surfaceData,
		...(withVersions
			? {
					versions: versions.map((v) => ({
						id: v.id,
						name: v.name,
						data: v.data,
						createdAt: v.createdAt,
						updatedAt: v.updatedAt
					})),
					activeVersionId: entry.activeVersionId
				}
			: {}),
		exportedAt: new Date().toISOString()
	};
}

/** Build a SillyTavern V2 card object for an entry. */
export function buildSillyTavernCard(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection
): SillyTavernCard {
	const surface = resolveSurfaceData(entry, versions, selection);
	const fields = traitsToCardFields(surface);
	const name = entry.identity.name ?? '';
	const tags = entry.identity.tags ? [...entry.identity.tags] : [];
	const block = buildExportBlock(entry, surface, versions, selection === 'all');
	return {
		spec: 'chara_card_v2',
		spec_version: '2.0',
		name,
		description: fields.description,
		personality: fields.personality,
		scenario: fields.scenario,
		first_mes: fields.first_mes,
		mes_example: fields.mes_example,
		data: {
			name,
			...fields,
			tags,
			extensions: { chungushub: block }
		}
	};
}

/** What we control per export. Each picture flag only bites when the character actually has
 *  that set. */
export interface ExportOptions {
	format: ExportFormat;
	includeGallery: boolean;
	includeSprites: boolean;
}

/** The picture sets this export has files to write, already filtered by what was asked for.
 *  Both empty means one bare card file and no archive. */
function pictureSets(entry: LibraryEntry, opts: ExportOptions): { gallery: string[]; sprites: CharacterSprite[] } {
	return {
		gallery: opts.includeGallery ? (entry.identity.gallery ?? []) : [],
		sprites: opts.includeSprites ? (entry.identity.sprites ?? []) : []
	};
}

interface CardFile {
	data: Uint8Array;
	mime: string;
	ext: 'json' | 'png';
}

/** Build the card file bytes for one entry: a JSON card (imageless) or a PNG card (portrait
 *  as art, card in the `chara` chunk). Shared by every export path. */
async function buildSillyTavernCardFile(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	format: ExportFormat
): Promise<CardFile> {
	const card = buildSillyTavernCard(entry, versions, selection);
	if (format === 'json') {
		return {
			data: new TextEncoder().encode(JSON.stringify(card, null, 2)),
			mime: 'application/json',
			ext: 'json'
		};
	}
	const basePng = await buildBasePng(entry);
	return { data: embedCardInPng(basePng, card), mime: 'image/png', ext: 'png' };
}

/** Export one entry. Plain single-file download normally; a `.zip` (card + the character's own
 *  `<name>/` folder) when either picture set is included. */
export async function exportEntryAsSillyTavern(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	opts: ExportOptions
): Promise<void> {
	const { gallery, sprites } = pictureSets(entry, opts);
	if (gallery.length === 0 && sprites.length === 0) {
		const { data, mime, ext } = await buildSillyTavernCardFile(entry, versions, selection, opts.format);
		// Cast: the DOM lib rejects Uint8Array<ArrayBufferLike> as a BlobPart over a SharedArrayBuffer nuance.
		triggerDownload(`${exportBaseName(entry)}.${ext}`, new Blob([data as BlobPart], { type: mime }));
		return;
	}
	const files = await buildCharacterFiles(entry, versions, selection, opts, new Set());
	triggerDownload(`${exportBaseName(entry)}.zip`, createZip(files));
}

/** Export several entries bundled into one `.zip`: one card each ('all' versions), plus each
 *  character's own folder when their pictures are included. */
export async function exportEntriesAsSillyTavernZip(
	targets: ExportTarget[],
	opts: ExportOptions
): Promise<void> {
	const files: ZipEntry[] = [];
	const usedBases = new Set<string>();
	for (const { entry, versions } of targets) {
		files.push(...(await buildCharacterFiles(entry, versions, 'all', opts, usedBases)));
	}
	triggerDownload('characters.zip', createZip(files));
}

/**
 * The zip entries for one character: its card (`<base>.<ext>`), its sprites (`<base>/joy.<ext>`)
 * and its gallery art (`<base>/gallery/1.<ext>`). `usedBases` keeps same-named characters apart
 * as `(2)`, `(3)`.
 *
 * **The sprites take the flat folder because that is SillyTavern's own sprite layout**: a folder
 * named after the card, one file per label. Dropped into a profile's `characters/` it is that
 * character's sprites to SillyTavern and to our own folder importer alike, so a pack keeps its
 * labels crossing the boundary. Gallery art therefore sits one level deeper, where neither
 * reader looks for a sprite: a flat pile of both sets would come back as sprites labelled "1",
 * "2", "3", taking the pack's real labels with it.
 */
export async function buildCharacterFiles(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	opts: ExportOptions,
	usedBases: Set<string>
): Promise<ZipEntry[]> {
	const base = uniqueBase(exportBaseName(entry), usedBases);
	const card = await buildSillyTavernCardFile(entry, versions, selection, opts.format);
	const files: ZipEntry[] = [{ name: `${base}.${card.ext}`, data: card.data }];
	const { gallery, sprites } = pictureSets(entry, opts);

	// The label is the filename, so two labels that sanitize alike would overwrite each other
	// inside the archive; `uniqueBase` keeps the second one instead.
	const usedLabels = new Set<string>();
	for (const sprite of sprites) {
		const file = await pictureFile(sprite.path, `${base}/${uniqueBase(sanitizeFilename(sprite.label), usedLabels)}`);
		if (file) files.push(file);
	}
	for (let i = 0; i < gallery.length; i++) {
		const file = await pictureFile(gallery[i], `${base}/gallery/${i + 1}`);
		if (file) files.push(file);
	}
	return files;
}

/** One stored picture as an archive entry under `name`, wearing the extension it is stored with
 *  (or the fetched blob's). Null for an empty path; a real 404 throws and surfaces. */
async function pictureFile(path: string, name: string): Promise<ZipEntry | null> {
	const blob = await fetchImageBlob(path);
	if (!blob) return null;
	const ext = fileExtension(path) ?? mimeExtension(blob.type);
	return { name: `${name}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) };
}

/** The export filename base for an entry: its name, or the same "Unnamed Character/Persona"
 *  fallback the UI shows, so a nameless character exports as "Unnamed Character.png", not "entry". */
function exportBaseName(entry: LibraryEntry): string {
	const fallback = entry.type === 'persona' ? 'Unnamed Persona' : 'Unnamed Character';
	// `?.trim() ||` so a blank or whitespace-only name still falls back instead of hitting
	// sanitizeFilename's generic "entry".
	return sanitizeFilename(entry.identity.name?.trim() || fallback);
}

/** Reserve a base name, disambiguating collisions as `name(2)`, `name(3)`, … */
function uniqueBase(name: string, used: Set<string>): string {
	if (!used.has(name)) {
		used.add(name);
		return name;
	}
	let i = 2;
	while (used.has(`${name}(${i})`)) i++;
	const unique = `${name}(${i})`;
	used.add(unique);
	return unique;
}

/** Lowercased file extension of a stored image path, or null when it has none. */
function fileExtension(path: string): string | null {
	const dot = path.lastIndexOf('.');
	if (dot === -1 || dot === path.length - 1) return null;
	return path.slice(dot + 1).toLowerCase();
}

function mimeExtension(mime: string): string {
	if (mime === 'image/jpeg') return 'jpg';
	if (mime === 'image/webp') return 'webp';
	if (mime === 'image/gif') return 'gif';
	return 'png';
}

/** Embed a card as a `chara` tEXt chunk into PNG bytes (pure, no DOM). */
export function embedCardInPng(basePng: Uint8Array, card: SillyTavernCard): Uint8Array {
	const base64 = encodeBase64Utf8(JSON.stringify(card));
	// `ccv3` is dropped but never written: we read both keywords and write only `chara`,
	// so a re-exported portrait can't carry a stale V3 card beside the fresh one.
	return insertTextChunk(basePng, buildTextChunk('chara', base64), ['chara', 'ccv3']);
}

/** Base PNG bytes for the card: the portrait (re-encoded if not already PNG), or a plain
 *  placeholder when the entry has no portrait. */
async function buildBasePng(entry: LibraryEntry): Promise<Uint8Array> {
	const blob = await fetchImageBlob(entry.identity.imageUrl);
	if (blob && blob.type === 'image/png') {
		return new Uint8Array(await blob.arrayBuffer());
	}
	if (blob) {
		return reencodeToPng(blob);
	}
	return makePlaceholderPng(entry.identity.name);
}
