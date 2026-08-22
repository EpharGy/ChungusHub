/**
 * The marker parser: the seam between what a model writes and what ComfyUI is asked for.
 *
 * The canonical marker is `[[IMG: prompt | AR | SHOT | SEED ]]`, and the canonical marker
 * is a recommendation rather than a rule. Models drop the seed, invent a fifth segment,
 * put the shot before the prompt, or state the same field twice, and every one of those is
 * a picture the reader still wants. So the parser reads the marker as a bag of segments and
 * takes control tokens wherever it finds them: whole segment, comma part, or single word.
 * Whatever it does not consume is prompt text.
 *
 * Only two shapes are unrecoverable, and both mean there was nothing to draw: an empty
 * marker, and one whose every part was a control token, leaving no prompt.
 *
 * What it salvaged is recorded rather than hidden ({@link RepairMeta}), because a marker
 * that was quietly repaired is exactly the one whose picture looks wrong to its author.
 *
 * Pure and dependency-free by design, so `bun test` can hold it to all of the above with no
 * DOM, no network and no ComfyUI. Seeds are NOT resolved here: `LOCK` means "the seed the
 * last picture used", which only the story tree can answer (see stores/imagegen.svelte.ts).
 */

import {
	AR_TOKENS,
	SHOT_TOKENS,
	type ArToken,
	type MarkerMatch,
	type MarkerResult,
	type RepairMeta,
	type SeedToken,
	type ShotToken
} from './types';

/** Matches one marker, capturing its body. Dot-all: a model may wrap a long prompt. */
const MARKER_RE = /\[\[IMG:\s*(.*?)\s*\]\]/s;
/** The same pattern, global, for walking every marker in a message. */
const MARKER_RE_GLOBAL = /\[\[IMG:\s*(.*?)\s*\]\]/gs;

const AR_SET: ReadonlySet<string> = new Set(AR_TOKENS);
const SHOT_SET: ReadonlySet<string> = new Set(SHOT_TOKENS);

/** Marker-level fallbacks. A lock in settings can still override what these choose. */
const DEFAULT_AR: ArToken = 'SQUARE';
const DEFAULT_SHOT: ShotToken = 'MEDIUM';
const DEFAULT_SEED: SeedToken = 'RANDOM';

/** Cheap pre-check for the render and trigger paths, which ask it of every message. */
export function hasImageMarker(text: string | null | undefined): boolean {
	return typeof text === 'string' && MARKER_RE.test(text);
}

function isSeedWord(value: string): boolean {
	return value === 'RANDOM' || value === 'LOCK' || /^\d+$/.test(value);
}

/** AR, SHOT or SEED — matched exactly and case-sensitively, so prose can never be mistaken
 *  for a control token. A model that writes `close` meant the word, not the framing. */
function classify(value: string): 'AR' | 'SHOT' | 'SEED' | null {
	if (AR_SET.has(value)) return 'AR';
	if (SHOT_SET.has(value)) return 'SHOT';
	if (isSeedWord(value)) return 'SEED';
	return null;
}

function emptyRepairMeta(): RepairMeta {
	return {
		defaulted: [],
		duplicateTokens: { AR: [], SHOT: [], SEED: [] },
		possibleSeedInPrompt: false
	};
}

interface TokenState {
	ar: string | null;
	shot: string | null;
	seed: string | null;
}

/** First value wins; later ones are noted and dropped. A model that states two aspect
 *  ratios has contradicted itself, and the earlier one is the one it committed to. */
function record(state: TokenState, type: 'AR' | 'SHOT' | 'SEED', value: string, meta: RepairMeta): void {
	const key = type === 'AR' ? 'ar' : type === 'SHOT' ? 'shot' : 'seed';
	if (state[key] === null) state[key] = value;
	else meta.duplicateTokens[type].push(value);
}

/**
 * A word inside a larger phrase. Only the spelled-out tokens are taken here, never a bare
 * number: `standing on platform 9` is prompt text, and consuming that 9 as a seed would
 * quietly change both the picture and the sentence describing it.
 */
function consumeWord(word: string, state: TokenState, meta: RepairMeta): string {
	let type: 'AR' | 'SHOT' | 'SEED' | null = null;
	if (AR_SET.has(word)) type = 'AR';
	else if (SHOT_SET.has(word)) type = 'SHOT';
	else if (word === 'RANDOM' || word === 'LOCK') type = 'SEED';

	if (!type) return word;
	record(state, type, word, meta);
	return '';
}

/**
 * One comma-separated part. A part that is *entirely* a token is one, including a bare
 * number: a lone `84512` between commas is a seed the model put in the wrong segment,
 * where the same digits inside a phrase are part of the phrase.
 */
function consumeCommaPart(part: string, state: TokenState, meta: RepairMeta): string {
	const trimmed = part.trim();
	if (!trimmed) return '';

	const whole = classify(trimmed);
	if (whole) {
		record(state, whole, trimmed, meta);
		return '';
	}

	const leftover: string[] = [];
	for (const word of trimmed.split(/\s+/).filter(Boolean)) {
		const kept = consumeWord(word, state, meta);
		if (kept) leftover.push(kept);
	}
	return leftover.join(' ');
}

/** One pipe-separated segment, same three-level descent: whole segment, comma part, word. */
function consumeSegment(segment: string, state: TokenState, meta: RepairMeta): string {
	const trimmed = segment.trim();
	if (!trimmed) return '';

	const whole = classify(trimmed);
	if (whole) {
		record(state, whole, trimmed, meta);
		return '';
	}

	const leftover: string[] = [];
	for (const part of trimmed.split(',')) {
		const kept = consumeCommaPart(part, state, meta);
		if (kept) leftover.push(kept);
	}
	return leftover.join(', ');
}

/**
 * Parse one marker body (everything between `[[IMG:` and `]]`).
 *
 * The prompt is what survives the control-token sweep, rejoined with commas: pipes are
 * marker syntax and have no business reaching a checkpoint's text encoder.
 */
export function parseMarkerBody(body: string): MarkerResult {
	const meta = emptyRepairMeta();
	if (!body.trim()) return { status: 'parse_error', reason: 'empty_marker', repairMeta: meta };

	const state: TokenState = { ar: null, shot: null, seed: null };
	const kept: string[] = [];

	for (const segment of body.split('|')) {
		const leftover = consumeSegment(segment, state, meta);
		if (leftover) kept.push(leftover);
	}

	const prompt = kept.join(', ').trim();
	if (!prompt) return { status: 'parse_error', reason: 'empty_prompt', repairMeta: meta };

	// A warning, never an extraction: a four-digit number left in the prompt is usually a
	// year or a tag, but it is also what a misplaced seed looks like, and the reader is the
	// only one who can tell which.
	if (/\b\d{4,}\b/.test(prompt)) meta.possibleSeedInPrompt = true;

	let ar = state.ar as ArToken | null;
	let shot = state.shot as ShotToken | null;
	let seedRaw = state.seed;

	if (ar === null) {
		ar = DEFAULT_AR;
		meta.defaulted.push('AR');
	}
	if (shot === null) {
		shot = DEFAULT_SHOT;
		meta.defaulted.push('SHOT');
	}
	if (seedRaw === null) {
		meta.defaulted.push('SEED');
	}

	const seed: SeedToken =
		seedRaw === null
			? DEFAULT_SEED
			: seedRaw === 'RANDOM' || seedRaw === 'LOCK'
				? seedRaw
				: Number(seedRaw);

	return { status: 'ok', prompt, ar, shot, seed, repairMeta: meta };
}

/**
 * Every marker in a message, in the order they appear, each with its offsets.
 *
 * The offsets are what bind a picture to a place: the body is split on them at render
 * time, and `index` is the key the picture is filed under on the message. Both are derived
 * from the text on every read rather than stored, so an edit that adds or removes a marker
 * re-indexes the rest in the same tick, exactly like memory's derived boundary.
 */
export function findMarkers(text: string | null | undefined): MarkerMatch[] {
	if (typeof text !== 'string' || !text) return [];

	const out: MarkerMatch[] = [];
	for (const match of text.matchAll(MARKER_RE_GLOBAL)) {
		const raw = match[0];
		const start = match.index ?? 0;
		out.push({
			index: out.length,
			raw,
			start,
			end: start + raw.length,
			result: parseMarkerBody(match[1] ?? '')
		});
	}
	return out;
}

/** A run of message text, or the place a marker stood. */
export type BodySegment =
	| { kind: 'text'; text: string }
	| { kind: 'marker'; marker: MarkerMatch };

/**
 * Split a message into the runs of text between its markers and the markers themselves.
 *
 * This is what lets a picture render where the model put it while the marker stays in the
 * stored text — which is the whole trick: the turn's own words are never rewritten, so no
 * summary is invalidated, no edit stamp is spent, and the model sees its own marker again
 * next turn and can hold a character's look across pictures for free.
 *
 * A message with no markers comes back as a single text segment, so the caller can keep
 * rendering the common case exactly as it always did.
 */
export function splitOnMarkers(text: string | null | undefined): BodySegment[] {
	const content = typeof text === 'string' ? text : '';
	const markers = findMarkers(content);
	if (markers.length === 0) return [{ kind: 'text', text: content }];

	const segments: BodySegment[] = [];
	let cursor = 0;
	for (const marker of markers) {
		if (marker.start > cursor) {
			segments.push({ kind: 'text', text: content.slice(cursor, marker.start) });
		}
		segments.push({ kind: 'marker', marker });
		cursor = marker.end;
	}
	if (cursor < content.length) segments.push({ kind: 'text', text: content.slice(cursor) });
	return segments;
}

/** True when the parser had to fix something worth telling the reader about. Formatting
 *  alone does not count; only a defaulted field, an ignored duplicate, or a suspect number. */
export function wasRepaired(meta: RepairMeta | undefined | null): boolean {
	if (!meta) return false;
	return (
		meta.defaulted.length > 0 ||
		meta.duplicateTokens.AR.length > 0 ||
		meta.duplicateTokens.SHOT.length > 0 ||
		meta.duplicateTokens.SEED.length > 0 ||
		meta.possibleSeedInPrompt
	);
}
