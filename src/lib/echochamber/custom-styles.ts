/**
 * Reader-authored chat styles.
 *
 * A style is a name and a prompt, and nothing else. That is not a simplification of the
 * extension's editor, it IS the extension's Advanced mode: a name field and a raw textarea.
 * Its export is a plain `.md` of the prompt text with no wrapper and no metadata, which is
 * also exactly what the shipped `chat-styles/*.md` files are, so a style written for
 * SillyTavern-EchoChamber pastes in here unchanged and one written here pastes back.
 * Nothing may add a required field to a custom style without breaking that.
 *
 * Custom styles live in their own setting, apart from `EchoChamberSettings`, because they
 * are the one part of this feature that grows with use: keeping them separate means the
 * settings blob read on every boot stays a fixed handful of scalars.
 *
 * Pure: no DOM, no `$lib`, no Svelte.
 */

import type { ChatStyle } from './types';
import { builtInStyle } from './styles';

/**
 * How many styles a reader may keep, and how long one may be.
 *
 * Both exist to bound a synced setting rather than to express a real opinion about
 * authorship: this blob is rewritten whole on every edit and re-read by every device on the
 * settings broadcast. The prompt cap is generous - the longest shipped style is well under
 * a tenth of it - and is a guard against a paste that was never meant to be a style.
 */
export const MAX_CUSTOM_STYLES = 50;
export const MAX_PROMPT_LENGTH = 40000;
const MAX_NAME_LENGTH = 60;

/** Ids reserved by the styles that ship, so a custom one can never shadow a built-in. */
function isReserved(id: string): boolean {
	return builtInStyle(id) !== undefined;
}

/**
 * A url-safe id derived from the name, made unique against what already exists.
 *
 * Derived rather than random so a style's id is readable in a settings export and stays
 * recognisable to whoever is reading the blob; uniqued rather than overwritten so naming two
 * styles "Test" produces two styles.
 */
export function styleIdFor(name: string, taken: Iterable<string>): string {
	const existing = new Set(taken);
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 32) || 'style';

	let candidate = base;
	let n = 2;
	while (isReserved(candidate) || existing.has(candidate)) {
		candidate = `${base}-${n}`;
		n++;
	}
	return candidate;
}

function normalizeStyle(raw: unknown, taken: Set<string>): ChatStyle | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, MAX_NAME_LENGTH) : '';
	const prompt = typeof obj.prompt === 'string' ? obj.prompt.slice(0, MAX_PROMPT_LENGTH) : '';
	// A style with no prompt cannot produce a feed and a style with no name cannot be picked.
	if (!name || !prompt.trim()) return null;

	let id = typeof obj.id === 'string' ? obj.id.trim() : '';
	// A stored id that collides with a built-in (or with an earlier entry in this same blob)
	// is re-derived rather than dropped: the reader's prompt is the valuable part, and an id
	// is only ever a key.
	if (!id || isReserved(id) || taken.has(id)) id = styleIdFor(name, taken);
	taken.add(id);

	return {
		id,
		name,
		prompt,
		narrator: obj.narrator === true,
		usesStoryCast: obj.usesStoryCast === true,
		custom: true
	};
}

/**
 * Parse and sanitize the stored custom-style list.
 *
 * Same contract as the rest of the app's stored blobs: anything corrupt, missing or of the
 * wrong type degrades rather than throwing, because a bad blob must never be able to stop
 * the styles list from loading.
 */
export function normalizeCustomStyles(raw: unknown): ChatStyle[] {
	if (!Array.isArray(raw)) return [];
	const taken = new Set<string>();
	const out: ChatStyle[] = [];
	for (const entry of raw) {
		const style = normalizeStyle(entry, taken);
		if (style) out.push(style);
		if (out.length >= MAX_CUSTOM_STYLES) break;
	}
	return out;
}

/** Add a style, or replace the one already carrying its id. */
export function upsertStyle(styles: ChatStyle[], style: ChatStyle): ChatStyle[] {
	const index = styles.findIndex((s) => s.id === style.id);
	if (index === -1) return [...styles, style];
	const next = [...styles];
	next[index] = style;
	return next;
}

export function removeStyle(styles: ChatStyle[], id: string): ChatStyle[] {
	return styles.filter((s) => s.id !== id);
}

/**
 * A copy of any style, custom or shipped, as a new custom style.
 *
 * This is how a shipped style is edited: it is duplicated and the copy is changed. Editing
 * a built-in in place would mean a custom entry shadowing a reserved id, so the shipped text
 * could never be got back and an upstream revision to it could never reach a reader who had
 * once opened the editor on it.
 */
export function duplicateStyle(source: ChatStyle, taken: Iterable<string>): ChatStyle {
	const name = `${source.name} copy`.slice(0, MAX_NAME_LENGTH);
	return {
		id: styleIdFor(name, taken),
		name,
		prompt: source.prompt,
		narrator: source.narrator,
		usesStoryCast: source.usesStoryCast,
		custom: true
	};
}
