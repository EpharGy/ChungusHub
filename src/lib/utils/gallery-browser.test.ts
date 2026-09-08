/**
 * Which cards the gallery window offers, and in what order. The rules are small and the
 * failures are all invisible: a card missing from the picker looks like a card with no
 * pictures, and two cards swapping places between renders looks like nothing at all until
 * somebody clicks the wrong one. Run with `bun test`.
 */
import { describe, test, expect } from 'bun:test';
import { browsableCards, personaCount, type BrowsableEntry } from './gallery-browser';

function entry(
	id: string,
	type: 'character' | 'persona',
	name: string,
	gallery: string[] = ['a.png'],
	imageUrl?: string
): BrowsableEntry {
	return { id, type, identity: { name, gallery, imageUrl } };
}

const names = (cards: ReturnType<typeof browsableCards>) => cards.map((c) => c.name);
const ids = (cards: ReturnType<typeof browsableCards>) => cards.map((c) => c.id);

describe('browsableCards', () => {
	test('keeps only the cards with a picture to offer', () => {
		const cards = browsableCards([
			entry('a', 'character', 'Has one'),
			entry('b', 'character', 'Has none', []),
			{ id: 'c', type: 'character', identity: { name: 'No gallery at all' } }
		]);
		expect(names(cards)).toEqual(['Has one']);
	});

	test('personas come before characters', () => {
		const cards = browsableCards([
			entry('c1', 'character', 'Aardvark'),
			entry('p1', 'persona', 'Zebra')
		]);
		// Alphabetically the character wins and it still sorts second: the group is the outer
		// key, so a persona named Zebra outranks a character named Aardvark.
		expect(names(cards)).toEqual(['Zebra', 'Aardvark']);
	});

	test('alphabetical within each group, ignoring case', () => {
		const cards = browsableCards([
			entry('1', 'character', 'beta'),
			entry('2', 'character', 'Alpha'),
			entry('3', 'persona', 'delta'),
			entry('4', 'persona', 'Charlie')
		]);
		expect(names(cards)).toEqual(['Charlie', 'delta', 'Alpha', 'beta']);
	});

	test('two cards sharing a name keep a stable order', () => {
		// The library allows duplicate names and duplicating a card produces them routinely.
		// Without the id tiebreak the pair could swap between renders for no visible reason.
		const forwards = browsableCards([entry('z', 'character', 'Twin'), entry('a', 'character', 'Twin')]);
		const backwards = browsableCards([entry('a', 'character', 'Twin'), entry('z', 'character', 'Twin')]);
		expect(ids(forwards)).toEqual(['a', 'z']);
		expect(ids(backwards)).toEqual(ids(forwards));
	});

	test('a nameless card is called Untitled rather than sorting as an empty string', () => {
		const cards = browsableCards([
			entry('1', 'character', '   '),
			{ id: '2', type: 'character', identity: { gallery: ['a.png'] } }
		]);
		expect(names(cards)).toEqual(['Untitled', 'Untitled']);
	});

	test('the gallery is copied, so the picker cannot edit the library through it', () => {
		const source = entry('1', 'character', 'A', ['one.png', 'two.png']);
		const [card] = browsableCards([source]);
		card.gallery.push('three.png');
		expect(source.identity.gallery).toEqual(['one.png', 'two.png']);
	});

	test('a repeated path appears once, because the picker keys its tiles on it', () => {
		// A keyed block handed the same key twice throws, so a gallery holding one path twice
		// would take the whole window down rather than drawing the picture twice.
		const [card] = browsableCards([
			entry('1', 'character', 'A', ['one.png', 'two.png', 'one.png'])
		]);
		expect(card.gallery).toEqual(['one.png', 'two.png']);
	});

	test('a missing portrait is carried as absent rather than invented', () => {
		const [withPortrait, without] = browsableCards([
			entry('1', 'character', 'A', ['a.png'], 'images/a.png'),
			entry('2', 'character', 'B')
		]);
		expect(withPortrait.imageUrl).toBe('images/a.png');
		expect(without.imageUrl).toBeUndefined();
	});

	test('nothing in the library is an empty picker, not an error', () => {
		expect(browsableCards([])).toEqual([]);
	});
});

describe('personaCount', () => {
	test('counts the personas at the front, which is where the seam goes', () => {
		const cards = browsableCards([
			entry('c1', 'character', 'A'),
			entry('p1', 'persona', 'B'),
			entry('p2', 'persona', 'C')
		]);
		expect(personaCount(cards)).toBe(2);
	});

	test('one group only leaves no seam to draw', () => {
		expect(personaCount(browsableCards([entry('c', 'character', 'A')]))).toBe(0);
		expect(personaCount(browsableCards([entry('p', 'persona', 'A')]))).toBe(1);
	});
});
