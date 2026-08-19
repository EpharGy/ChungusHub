/**
 * Attached files: the read-only reference material a user hands the Chungus Assistant
 * (architecture/chungus-assistant.md).
 *
 * The bytes never come back as a static URL: an attached file is arbitrary text, and
 * serving it from the app's own origin would run an attached `.html` as a page beside the
 * session it belongs to. Everything here speaks JSON, and the viewer pages through
 * `readFileLines` rather than fetching a file whole.
 *
 * What a file may BE is decided server-side, by shape rather than by extension. This module
 * carries only the two rules that must be checked before an upload starts: the size, and
 * whether the thing is a picture (which belongs on the image path instead).
 */
import { apiGet, apiSend, apiUpload } from '$lib/services/transport';
import { readTextChunk } from '$lib/services/pngText';
import { MAX_ASSISTANT_FILE_BYTES, type AssistantFile } from '$shared/assistant-files';

export type { AssistantFile };

/**
 * What the File… picker offers. Convenience only: recognition is structural server-side, so
 * a card renamed `notes.txt` still reads as a card and a `.json` full of nothing still reads
 * as JSON. Some Android pickers ignore `accept` outright, which is exactly why nothing here
 * is load-bearing.
 */
export const ASSISTANT_FILE_ACCEPT = '.txt,.md,.json,.jsonl,.csv,.yaml,.yml,.log,.png';

function megabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A PNG carrying a character or preset card is a DOCUMENT, not a picture, and belongs on
 * the file path, which is the whole reason a drop cannot be routed on MIME type alone. The
 * chunk reader is the same one every card import uses, so the two can never disagree about
 * what a picture holds.
 */
export function isDocumentPng(bytes: Uint8Array): boolean {
	try {
		return readTextChunk(bytes, 'chara') !== null || readTextChunk(bytes, 'chungus_preset') !== null;
	} catch {
		return false;
	}
}

/** The reason a file cannot be attached, or null when it passes. */
export function fileRejectionReason(file: File): string | null {
	if (file.size > MAX_ASSISTANT_FILE_BYTES) {
		return `"${file.name}" is ${megabytes(file.size)}; the limit for an attached file is ${megabytes(MAX_ASSISTANT_FILE_BYTES)}.`;
	}
	return null;
}

/** Uploads one file against a tab. Throws with the server's own wording: every ingest
 *  refusal (not text, no document in the picture, too big) is the user's to read. */
export async function uploadAssistantFile(sessionId: string, file: File): Promise<AssistantFile> {
	const form = new FormData();
	form.append('file', file);
	form.append('name', file.name);
	form.append('sessionId', sessionId);
	const data = (await apiUpload('/api/assistant-files', form)) as { file: AssistantFile };
	return data.file;
}

/** Every file of one tab, staged and sent alike, oldest first. */
export async function listAssistantFiles(sessionId: string): Promise<AssistantFile[]> {
	const data = (await apiGet(`/api/assistant-files?sessionId=${encodeURIComponent(sessionId)}`)) as { files: AssistantFile[] };
	return data.files ?? [];
}

/** Throws away a file still staged in the composer. A sent one belongs to its turn and the
 *  server refuses: the transcript names it, so a row deleted under that would leave the
 *  assistant's own record pointing at nothing. */
export async function deleteAssistantFile(id: string): Promise<void> {
	await apiSend('/api/assistant-files/delete', 'POST', { id });
}

export interface FileTextPage {
	file: AssistantFile;
	fromLine: number;
	toLine: number;
	totalLines: number;
	lines: string[];
}

/** One window of a file's text, 1-based and inclusive. The viewer pages with this because a
 *  10 MB file must never reach the DOM in one string. */
export async function readFileLines(id: string, from: number, to: number): Promise<FileTextPage> {
	return (await apiGet(
		`/api/assistant-files/text?id=${encodeURIComponent(id)}&from=${from}&to=${to}`
	)) as FileTextPage;
}
