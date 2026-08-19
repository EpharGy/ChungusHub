/**
 * Turning an upload into an attached file row.
 *
 * This is the container layer: it knows that a `.png` is a wrapper around a document and
 * that raw bytes may not be text at all, and it hands the resulting TEXT to files-core.ts,
 * which owns recognition and the line math. The split is what keeps files-core pure and
 * testable without a data dir.
 *
 * Every refusal here is loud and final: nothing is stored, and the client shows what the
 * server said. A file the assistant cannot read is not one to keep half of.
 */
import { randomUUID } from 'node:crypto';
// The PNG chunk reader is shared with the client, deliberately: an attached card and an
// imported card must be read by the same code, or the two disagree about what a picture
// holds. It is pure and free of $lib value imports for exactly this reason
// (architecture/sillytavern-interchange.md).
import { decodeBase64Utf8, readTextChunk } from '../../src/lib/services/pngText';
import { countLines, detectFileKind, normalizeText, prettyJson } from './files-core';
import { MAX_ASSISTANT_FILE_BYTES, type FileKind } from '../../shared/assistant-files';
import { estimateTextTokens } from './registry/schema';
import { saveAssistantFileText } from '../files';
import { serverDb, type AssistantFileRow } from '../db';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
	return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Bytes that are not valid UTF-8 text. `fatal` is the whole point: the lenient decode
 *  would hand back a page of replacement characters and call a JPEG a text file. */
function decodeUtf8(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

/**
 * The document inside a picture, or a refusal.
 *
 * Only the two keywords this app already claims are read, in the order the boundary states:
 * `chara` is a character card and `chungus_preset` is a preset, and a picture carrying
 * neither has nothing here to read. Ordering matters and is asserted by the interchange
 * tests: a preset card contains no `chara` keyword at all, so neither can be mistaken for
 * the other (architecture/sillytavern-interchange.md).
 */
function unwrapPng(bytes: Uint8Array): string {
	for (const keyword of ['chara', 'chungus_preset'] as const) {
		const chunk = readTextChunk(bytes, keyword);
		if (chunk === null) continue;
		try {
			return decodeBase64Utf8(chunk);
		} catch {
			throw new Error(`This picture carries a "${keyword}" document, but it could not be decoded.`);
		}
	}
	throw new Error(
		'This picture holds no document. A character card or a preset card can be attached as a file; an ordinary picture is attached as an image instead.'
	);
}

export interface IngestedFile {
	text: string;
	kind: FileKind;
}

/**
 * Upload bytes → the text the assistant will read.
 *
 * Order is load-bearing: a PNG is binary and would fail the UTF-8 decode, so the signature
 * is checked first. JSON is re-printed because a minified document is one line, and against
 * one line both a range read and a search are useless (files-core.ts).
 */
export function ingestFileBytes(bytes: Uint8Array, name: string): IngestedFile {
	if (bytes.byteLength > MAX_ASSISTANT_FILE_BYTES) {
		throw new Error(`"${name}" is over the ${MAX_ASSISTANT_FILE_BYTES / (1024 * 1024)} MB limit for an attached file.`);
	}
	const raw = isPng(bytes) ? unwrapPng(bytes) : decodeUtf8(bytes);
	if (raw === null) {
		throw new Error(`"${name}" is not a text file. The assistant reads files as text; attach a picture as an image instead.`);
	}
	const normalized = normalizeText(raw);
	const kind = detectFileKind(normalized);
	// Re-printing is decided by what the text IS, not by its extension: a `.txt` holding a
	// minified card gets lines to address, and prose is left exactly as written.
	const text = kind === 'jsonl' || kind === 'sillytavern-chat' ? normalized : (prettyJson(normalized) ?? normalized);
	return { text, kind };
}

/** Ingests one upload and records it against a session. The row is created unbound
 *  (`messageId` null). It belongs to a turn only once one is sent. */
export function storeAssistantFile(sessionId: string, name: string, bytes: Uint8Array): AssistantFileRow {
	const { text, kind } = ingestFileBytes(bytes, name);
	const row: AssistantFileRow = {
		id: randomUUID(),
		sessionId,
		messageId: null,
		name,
		kind,
		bytes: Buffer.byteLength(text, 'utf-8'),
		lines: countLines(text),
		tokenEstimate: estimateTextTokens(text),
		textPath: saveAssistantFileText(text),
		createdAt: Date.now()
	};
	serverDb.createAssistantFile(row);
	return row;
}
