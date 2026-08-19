import { describe, test, expect } from 'bun:test';
import {
	SPRITE_LABEL_SUGGESTIONS,
	findLabelConflict,
	normalizeSpriteLabel,
	pickLabel,
	resolveDefaultSprite,
	sortSprites,
	spriteForLabel
} from './sprites';
import type { CharacterSprite } from '$lib/types/library';

const POOL: CharacterSprite[] = [
	{ path: 'images/characters/a.png', label: 'neutral' },
	{ path: 'images/characters/b.png', label: 'Joy' },
	{ path: 'images/characters/c.png', label: 'quiet anger' }
];

describe('normalizeSpriteLabel', () => {
	test('trims and collapses whitespace, and keeps the casing the user typed', () => {
		expect(normalizeSpriteLabel('  quiet   anger \n')).toBe('quiet anger');
		expect(normalizeSpriteLabel('Joy')).toBe('Joy');
	});
});

describe('spriteForLabel', () => {
	test('matches case-insensitively: a pack ships Joy.png and a model answers "joy"', () => {
		expect(spriteForLabel(POOL, 'joy')?.path).toBe('images/characters/b.png');
		expect(spriteForLabel(POOL, 'JOY')?.path).toBe('images/characters/b.png');
		expect(spriteForLabel(POOL, '  Quiet Anger ')?.path).toBe('images/characters/c.png');
	});

	test('a label no sprite carries resolves to nothing rather than a near match', () => {
		expect(spriteForLabel(POOL, 'angry')).toBeNull();
		expect(spriteForLabel(POOL, '')).toBeNull();
		expect(spriteForLabel(POOL, null)).toBeNull();
		expect(spriteForLabel(undefined, 'joy')).toBeNull();
	});
});

describe('findLabelConflict', () => {
	test('a label already in use is refused, whatever its casing', () => {
		expect(findLabelConflict(POOL, 'JOY')?.path).toBe('images/characters/b.png');
		expect(findLabelConflict(POOL, 'grief')).toBeNull();
	});

	test('the picture being relabelled never collides with itself', () => {
		expect(findLabelConflict(POOL, 'Joy', 'images/characters/b.png')).toBeNull();
	});
});

describe('resolveDefaultSprite: a character with sprites always has one', () => {
	test('keeps a default that still names a sprite', () => {
		expect(resolveDefaultSprite(POOL, 'images/characters/b.png')).toBe('images/characters/b.png');
	});

	test('hands the role on when the default is gone', () => {
		const survivors = POOL.filter((s) => s.path !== 'images/characters/b.png');
		expect(resolveDefaultSprite(survivors, 'images/characters/b.png')).toBe('images/characters/a.png');
	});

	test('the first sprite of a fresh pool becomes the default with nothing to choose from', () => {
		expect(resolveDefaultSprite(POOL, undefined)).toBe('images/characters/a.png');
	});

	test('an empty pool has no default: the panel has nothing to draw and says so by absence', () => {
		expect(resolveDefaultSprite([], 'images/characters/a.png')).toBeUndefined();
	});
});

describe('sortSprites', () => {
	test('upload order is the stored order, which is the order a pack arrived in', () => {
		expect(sortSprites(POOL, 'upload').map((s) => s.label)).toEqual([
			'neutral',
			'Joy',
			'quiet anger'
		]);
	});

	test('sorts by label, ignoring the casing a pack happened to ship', () => {
		expect(sortSprites(POOL, 'a-z').map((s) => s.label)).toEqual(['Joy', 'neutral', 'quiet anger']);
		expect(sortSprites(POOL, 'z-a').map((s) => s.label)).toEqual(['quiet anger', 'neutral', 'Joy']);
	});

	test('never reorders the stored list, so the default sprite stays the first one in', () => {
		const before = POOL.map((sprite) => sprite.label);
		sortSprites(POOL, 'a-z');
		sortSprites(POOL, 'z-a');
		expect(POOL.map((sprite) => sprite.label)).toEqual(before);
		expect(resolveDefaultSprite(POOL, undefined)).toBe('images/characters/a.png');
	});
});

describe('pickLabel: the Sprites answer contract', () => {
	const LABELS = POOL.map((sprite) => sprite.label);

	test('takes the label out of plain JSON', () => {
		expect(pickLabel('{"sprite": "neutral"}', LABELS)).toBe('neutral');
	});

	test('survives a fence and a sentence of preamble, which small models add', () => {
		expect(pickLabel('```json\n{"sprite":"joy"}\n```', LABELS)).toBe('Joy');
		expect(pickLabel('Sure! Here you go: {"sprite": "joy"} — hope that helps.', LABELS)).toBe('Joy'); // em-dash: data
	});

	test("answers with the character's own spelling, never the model's casing", () => {
		expect(pickLabel('{"sprite": "JOY"}', LABELS)).toBe('Joy');
		expect(pickLabel('{"sprite": "  Quiet Anger "}', LABELS)).toBe('quiet anger');
	});

	test('a label outside the pool fails rather than landing near it', () => {
		expect(() => pickLabel('{"sprite": "angry"}', LABELS)).toThrow(/not one of/);
		expect(() => pickLabel('{"sprite": "joyful"}', LABELS)).toThrow(/not one of/);
	});

	test('prose with no JSON in it fails, and says what came back', () => {
		expect(() => pickLabel('She seems happy.', LABELS)).toThrow(/no label/);
		expect(() => pickLabel('', LABELS)).toThrow(/no label/);
	});

	test('a well-formed object with the wrong shape still fails', () => {
		expect(() => pickLabel('{"expression": "joy"}', LABELS)).toThrow(/no label/);
		expect(() => pickLabel('{"sprite": ""}', LABELS)).toThrow(/no label/);
		expect(() => pickLabel('{"sprite": ["joy"]}', LABELS)).toThrow(/no label/);
	});
});

describe('SPRITE_LABEL_SUGGESTIONS', () => {
	test('are unique and lowercase, so a pack filename lands on one of them verbatim', () => {
		expect(new Set(SPRITE_LABEL_SUGGESTIONS).size).toBe(SPRITE_LABEL_SUGGESTIONS.length);
		for (const label of SPRITE_LABEL_SUGGESTIONS) expect(label).toBe(label.toLowerCase());
	});

	test('lead with neutral: the label an imported pack always carries', () => {
		expect(SPRITE_LABEL_SUGGESTIONS[0]).toBe('neutral');
	});
});
