/**
 * Attached-file text handling: pure string work, no I/O.
 *
 * Kept free of the database and the filesystem the way toolProgress.ts and freshness-core.ts
 * are, so `bun test` can drive recognition, normalization and the line math without a data
 * dir. Its one import is the shared vocabulary both sides speak (shared/assistant-files.ts).
 * The ingest layer (files-ingest.ts) owns containers: it unwraps a document out of a PNG,
 * writes bytes, and hands the TEXT here. Everything below addresses that text by 1-based
 * line number and nothing else.
 *
 * Line numbers are the whole addressing scheme, and they are trustworthy for one reason: an
 * attached file is read-only for its whole life, so a range read in one turn still names the
 * same lines twenty turns later. That is why normalization happens exactly once, at ingest:
 * the stored text IS the addressable artifact, and re-deriving it per read would let a line
 * number mean two different things.
 */
import type { FileKind } from '../../shared/assistant-files';

/** A search match's line is clipped to this many characters. A minified file that ingest
 *  could not pretty-print (JS, CSS, XML) has lines hundreds of kilobytes long, and one
 *  unclipped match would put the whole file in the context the search exists to avoid. */
export const MATCH_LINE_CLIP = 200;

/**
 * The one normalization, applied at ingest: a leading BOM goes, and CRLF/CR become LF.
 * Without it a Windows-authored file carries `\r` into every read the model sees, and the
 * line count drifts against a viewer that split on LF.
 */
export function normalizeText(raw: string): string {
	return raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Parsed JSON, or null when the text is not one JSON document. */
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pretty-printed JSON, or null when the text is not JSON.
 *
 * This is what makes line addressing work on the files this feature exists for: a world-info
 * export or a character card is routinely one line of several hundred kilobytes, and against
 * that a range read and a search are both useless: every match reports line 1 and the only
 * possible read is the whole file. Re-printing is therefore not cosmetic; it is what gives
 * the text somewhere to be addressed.
 */
export function prettyJson(text: string): string | null {
	const parsed = parseJson(text);
	if (parsed === null) return null;
	return JSON.stringify(parsed, null, 2);
}

/** A card names its greeting field, at either card generation's nesting. */
function looksLikeCard(root: Record<string, unknown>): boolean {
	const data = isRecord(root.data) ? root.data : root;
	return typeof data.first_mes === 'string' || typeof data.mes_example === 'string';
}

/** The three world-info shapes, told apart the way `parseLorebook` tells them apart:
 *  an embedded `character_book` first, then `entries` as an array (character_book shape),
 *  then `entries` as an object keyed by uid (native World Info). */
function looksLikeWorldInfo(root: Record<string, unknown>): boolean {
	if (isRecord(root.character_book)) return true;
	if (isRecord(root.data) && isRecord((root.data as Record<string, unknown>).character_book)) return true;
	return Array.isArray(root.entries) || isRecord(root.entries);
}

/** `isSillyTavernScript` is `typeof raw.findRegex === 'string'`, nothing more. */
function looksLikeRegexScript(value: unknown): boolean {
	if (isRecord(value)) return typeof value.findRegex === 'string';
	return Array.isArray(value) && value.length > 0 && value.every(looksLikeRegexScript);
}

/** A preset document is named `items` plus the assembly settings only a preset carries. */
function looksLikePreset(root: Record<string, unknown>): boolean {
	if (!Array.isArray(root.items)) return false;
	return 'exampleSeparator' in root || 'continuePrompt' in root || 'pruneEmptyBlocks' in root;
}

/**
 * What this text is, by shape alone.
 *
 * A card is checked BEFORE world info because a card may embed a `character_book` and is
 * still a card; a `.jsonl` is only claimed as a SillyTavern chat when its first line is the
 * `chat_metadata` header that format always opens with.
 */
export function detectFileKind(text: string): FileKind {
	const trimmed = text.trim();
	if (!trimmed) return 'text';

	const parsed = parseJson(trimmed);
	if (parsed !== null) {
		if (looksLikeRegexScript(parsed)) return 'regex-script';
		if (isRecord(parsed)) {
			if (parsed.format === 'chungushub.libraryEntry') return 'chungus-library-entry';
			if (parsed.type === 'chungushub.assistantSkills') return 'chungus-skills';
			if (looksLikePreset(parsed)) return 'chungus-preset';
			if (looksLikeCard(parsed)) return 'sillytavern-card';
			if (looksLikeWorldInfo(parsed)) return 'world-info';
		}
		return 'json';
	}

	// Not one document. JSON Lines is the only multi-document text shape we claim, and a
	// SillyTavern chat is the one JSONL whose header line names it.
	const lines = trimmed.split('\n').filter((l) => l.trim() !== '');
	if (lines.length < 2) return 'text';
	const first = parseJson(lines[0]);
	if (first === null) return 'text';
	if (isRecord(first) && 'chat_metadata' in first) return 'sillytavern-chat';
	// Every line a document, or it is prose that merely opens with a brace.
	return lines.every((l) => parseJson(l) !== null) ? 'jsonl' : 'text';
}

/** Lines as the whole app counts them: a trailing newline does not open a final empty line. */
export function splitLines(text: string): string[] {
	const body = text.endsWith('\n') ? text.slice(0, -1) : text;
	return body === '' ? [] : body.split('\n');
}

export function countLines(text: string): number {
	return splitLines(text).length;
}

/** `  12 | the line`: the gutter every read and the viewer share, so a line number quoted
 *  from one surface addresses the same line in the other. Width follows the file's last
 *  line number, so the gutter never jitters mid-read. */
export function renderNumbered(lines: string[], firstLine: number, totalLines: number): string {
	const width = String(totalLines).length;
	return lines.map((line, i) => `${String(firstLine + i).padStart(width, ' ')} | ${line}`).join('\n');
}

/** A 1-based inclusive range clamped to what the file actually has. An empty file yields an
 *  empty range rather than a phantom line 1. */
export function clampRange(totalLines: number, from?: number, to?: number): { from: number; to: number } {
	if (totalLines === 0) return { from: 0, to: -1 };
	const start = Math.max(1, Math.min(from ?? 1, totalLines));
	const end = Math.max(start, Math.min(to ?? totalLines, totalLines));
	return { from: start, to: end };
}

export interface FileMatch {
	line: number;
	/** The matching line, clipped to MATCH_LINE_CLIP with a tail marker when it was longer. */
	text: string;
}

export interface FileSearchResult {
	matches: FileMatch[];
	/** Every match in the file, not just the page, so a note can say what was left out. */
	total: number;
}

/**
 * Substring search over the stored text, line by line.
 *
 * Deliberately not a regex: the model composes the query, a pathological pattern over a 10 MB
 * file is a server-side hang with nothing to stop it, and every real question here ("where is
 * Aria mentioned") is a substring. `limit` bounds the page; `total` is honest about the rest.
 */
export function searchFile(text: string, query: string, caseSensitive: boolean, limit: number): FileSearchResult {
	const needle = caseSensitive ? query : query.toLowerCase();
	const matches: FileMatch[] = [];
	let total = 0;
	const lines = splitLines(text);
	for (let i = 0; i < lines.length; i += 1) {
		const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
		if (!hay.includes(needle)) continue;
		total += 1;
		if (matches.length >= limit) continue;
		const line = lines[i];
		matches.push({
			line: i + 1,
			text: line.length > MATCH_LINE_CLIP ? `${line.slice(0, MATCH_LINE_CLIP)}…` : line
		});
	}
	return { matches, total };
}
