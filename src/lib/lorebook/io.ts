/**
 * Browser glue for lorebook files: download + file read. The actual format conversion lives
 * in `sillytavern.ts`; this only handles the Blob/anchor/FileReader plumbing so components stay
 * free of it. Export is SillyTavern native World Info (its "Import World Info" reads it).
 */
import type { Lorebook } from './types';
import { parseLorebook, toNativeWorldInfo } from './sillytavern';

function sanitizeFilename(name: string): string {
	// Strip only what filesystems reject (reserved punctuation + control chars) so
	// unicode names (ğ, ü, 龍, …) stay intact.
	// eslint-disable-next-line no-control-regex
	const cleaned = (name || '').replace(/[\\/:*?"<>|]|[\x00-\x1f]/g, '').trim();
	return cleaned || 'lorebook';
}

/** Download a book as SillyTavern-compatible World Info JSON. */
export function downloadLorebook(book: Lorebook): void {
	const json = JSON.stringify(toNativeWorldInfo(book), null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${sanitizeFilename(book.name)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

/** Read + parse a lorebook file into a fresh Lorebook. Throws (loudly) on bad JSON / format. */
export async function readLorebookFile(file: File): Promise<Lorebook> {
	const text = await file.text();
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error(`"${file.name}" is not valid JSON.`);
	}
	const fallbackName = file.name.replace(/\.[^.]+$/, '');
	return parseLorebook(raw, fallbackName);
}
