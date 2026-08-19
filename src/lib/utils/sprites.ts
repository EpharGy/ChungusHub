/**
 * Sprites: the pure model behind a character's labelled pictures.
 *
 * Pure by design: the library store writes through these, the Sprites engine resolves a model's
 * answer through them, and the two must agree exactly or the engine picks a label the editor
 * cannot show.
 *
 * Labels are stored as the user typed them and matched case-insensitively, because a sprite
 * pack ships `Joy.png` and a model answers "joy".
 */
import type { CharacterSprite } from '$lib/types/library';
import { parseJsonObject } from '$lib/utils/json-extract';
// These three live in `shared/` because the server seeds the example character through them
// too, and it cannot import `$lib`. Re-exported here so this file stays the client's one door.
import { labelFromFilename, normalizeSpriteLabel, resolveDefaultSprite } from '$shared/sprites';

export { labelFromFilename, normalizeSpriteLabel, resolveDefaultSprite };

/**
 * The labels offered when a sprite is named. SillyTavern's emotion vocabulary, which is also
 * what sprite-pack filenames use, so an imported pack and a hand-named sprite speak the same
 * words. Suggestions only: a label is free text, so a set that varies outfits as well as moods
 * names its own.
 */
export const SPRITE_LABEL_SUGGESTIONS = [
	'neutral',
	'admiration',
	'amusement',
	'anger',
	'annoyance',
	'approval',
	'caring',
	'confusion',
	'curiosity',
	'desire',
	'disappointment',
	'disapproval',
	'disgust',
	'embarrassment',
	'excitement',
	'fear',
	'gratitude',
	'grief',
	'joy',
	'love',
	'nervousness',
	'optimism',
	'pride',
	'realization',
	'relief',
	'remorse',
	'sadness',
	'surprise'
] as const;

/** How the editor's Sprites grid is ordered on screen. The names the user picks between live
 *  with the preference that stores them (`stores/spriteSort.svelte.ts`). */
export type SpriteSort = 'upload' | 'a-z' | 'z-a';

/**
 * The sprites in display order.
 *
 * A view and never a write: the stored list keeps the order the files arrived in, which is
 * what makes "upload order" somewhere the user can go back to, and what keeps the default
 * sprite (`resolveDefaultSprite` takes the first one) from moving when someone sorts the grid.
 */
export function sortSprites(sprites: CharacterSprite[], order: SpriteSort): CharacterSprite[] {
	if (order === 'upload') return sprites;
	const sorted = [...sprites].sort((a, b) =>
		a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })
	);
	return order === 'a-z' ? sorted : sorted.reverse();
}

/** The sprite a label names, or null. Case-insensitive: the model's casing is not a choice. */
export function spriteForLabel(
	sprites: CharacterSprite[] | undefined,
	label: string | null | undefined
): CharacterSprite | null {
	if (!label) return null;
	const key = normalizeSpriteLabel(label).toLowerCase();
	return sprites?.find((s) => s.label.toLowerCase() === key) ?? null;
}

/**
 * The sprite already using this label, ignoring one path (the picture being relabelled), or
 * null when the label is free.
 *
 * Labels are unique per character because the engine answers with one and expects one picture
 * back. Two sprites sharing a label would make the second unreachable forever, with nothing on
 * screen admitting it, so a collision is refused at the point of naming instead.
 */
export function findLabelConflict(
	sprites: CharacterSprite[] | undefined,
	label: string,
	exceptPath?: string
): CharacterSprite | null {
	const key = normalizeSpriteLabel(label).toLowerCase();
	return sprites?.find((s) => s.path !== exceptPath && s.label.toLowerCase() === key) ?? null;
}

/**
 * The character's own label for a raw Sprites reply, or a throw.
 *
 * An answer that is not one of the given labels is a failure and not a near-match hunt: the
 * whole reason for asking a model rather than matching keywords is that the answer means
 * something, and a fuzzy fallback would put a confident wrong picture on screen instead of
 * telling the reader the engine is not working. What comes back is the label as the character
 * spells it, never the model's casing, so one sprite is named one way everywhere.
 */
export function pickLabel(raw: string, labels: string[]): string {
	const answer = parseJsonObject(raw).sprite;
	if (typeof answer !== 'string' || !answer.trim()) {
		throw new Error(`Sprites returned no label: ${raw.trim().slice(0, 120)}`);
	}
	const key = normalizeSpriteLabel(answer).toLowerCase();
	const match = labels.find((label) => label.toLowerCase() === key);
	if (!match) {
		throw new Error(`Sprites answered “${answer.trim()}”, which is not one of this character's labels`);
	}
	return match;
}
