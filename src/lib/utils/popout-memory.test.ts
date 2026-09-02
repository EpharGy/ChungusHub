/**
 * What the pop-out remembers per character, pinned. The recency rule and the cap decide
 * whether a window you left open comes back weeks later, and neither is visible from the
 * outside until it silently does not. Run with `bun test`.
 *
 * The thing most worth pinning here is that the key and the source are allowed to differ:
 * the key is the story being READ, the source is whose gallery the picture came from, and
 * conflating them is exactly the bug this shape exists to prevent.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
	MEMORY_LIMIT,
	forgetIn,
	forgetPopout,
	readPopoutMemory,
	rememberIn,
	rememberPopout,
	type PopoutMemory
} from './popout-memory';

const one = { path: 'images/one.png', sourceId: 'src-1' };
const two = { path: 'images/two.png', sourceId: 'src-2' };

describe('rememberIn', () => {
	test('records a picture against the character being read', () => {
		expect(rememberIn({}, 'a', one)).toEqual({ a: one });
	});

	test('keeps a source that is not the character keyed on', () => {
		// Character A's art, opened while reading character B, belongs to B and is found
		// again in A's gallery. Both halves have to survive the round trip.
		const map = rememberIn({}, 'char-b', { path: 'a.png', sourceId: 'char-a' });
		expect(map['char-b']).toEqual({ path: 'a.png', sourceId: 'char-a' });
	});

	test('replaces the picture a character was already on', () => {
		expect(rememberIn({ a: one }, 'a', two)).toEqual({ a: two });
	});

	test('leaves the source map alone', () => {
		const before: PopoutMemory = { a: one };
		rememberIn(before, 'b', two);
		expect(before).toEqual({ a: one });
	});

	test('moves a character you return to back to the front of the queue', () => {
		// Assigning in place would leave `a` in its original slot, so a character opened
		// daily would still age out behind ones untouched for weeks.
		const map = rememberIn(rememberIn(rememberIn({}, 'a', one), 'b', two), 'a', two);
		expect(Object.keys(map)).toEqual(['b', 'a']);
	});

	test('drops the oldest once the cap is reached', () => {
		let map: PopoutMemory = {};
		for (let i = 0; i < MEMORY_LIMIT + 3; i++) {
			map = rememberIn(map, `c${i}`, { path: `${i}.png`, sourceId: 's' });
		}
		expect(Object.keys(map)).toHaveLength(MEMORY_LIMIT);
		expect(map.c0).toBeUndefined();
		expect(map.c2).toBeUndefined();
		expect(map[`c${MEMORY_LIMIT + 2}`]?.path).toBe(`${MEMORY_LIMIT + 2}.png`);
	});

	test('honours a smaller cap', () => {
		const map = rememberIn(rememberIn({ a: one }, 'b', two), 'c', one, 2);
		expect(Object.keys(map)).toEqual(['b', 'c']);
	});
});

describe('forgetIn', () => {
	test('removes just that character', () => {
		expect(forgetIn({ a: one, b: two }, 'a')).toEqual({ b: two });
	});

	test('a character with nothing remembered is not an error', () => {
		expect(forgetIn({ a: one }, 'z')).toEqual({ a: one });
	});
});

describe('storage', () => {
	let store: Map<string, string>;
	const original = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		store = new Map();
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		};
	});

	afterEach(() => {
		(globalThis as { localStorage?: unknown }).localStorage = original;
	});

	test('a remembered picture survives the round trip', () => {
		rememberPopout('char-1', one);
		expect(readPopoutMemory()).toEqual({ 'char-1': one });
	});

	test('forgetting one leaves the others', () => {
		rememberPopout('char-1', one);
		rememberPopout('char-2', two);
		forgetPopout('char-1');
		expect(readPopoutMemory()).toEqual({ 'char-2': two });
	});

	test('nothing saved reads as nothing', () => {
		expect(readPopoutMemory()).toEqual({});
	});

	test('a malformed record reads as nothing rather than throwing', () => {
		store.set('image-popout-by-character', '{not json');
		expect(readPopoutMemory()).toEqual({});
	});

	test('half an entry is dropped, since a path with no source has no set to page', () => {
		store.set(
			'image-popout-by-character',
			JSON.stringify({
				good: one,
				noSource: { path: 'x.png' },
				noPath: { sourceId: 's' },
				notAnObject: 'x.png',
				empty: { path: '', sourceId: '' }
			})
		);
		expect(readPopoutMemory()).toEqual({ good: one });
	});
});
