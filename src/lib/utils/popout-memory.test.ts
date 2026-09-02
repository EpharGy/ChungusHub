/**
 * What the pop-out remembers per character, pinned. The recency rule and the cap decide
 * whether a window you left open comes back weeks later, and neither is visible from the
 * outside until it silently does not. Run with `bun test`.
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

describe('rememberIn', () => {
	test('records a path against a character', () => {
		expect(rememberIn({}, 'a', 'images/one.png')).toEqual({ a: 'images/one.png' });
	});

	test('replaces the path a character was already on', () => {
		expect(rememberIn({ a: 'one.png' }, 'a', 'two.png')).toEqual({ a: 'two.png' });
	});

	test('leaves the source map alone', () => {
		const before: PopoutMemory = { a: 'one.png' };
		rememberIn(before, 'b', 'two.png');
		expect(before).toEqual({ a: 'one.png' });
	});

	test('moves a character you return to back to the front of the queue', () => {
		// Assigning in place would leave `a` in its original slot, so a character opened
		// daily would still age out behind ones untouched for weeks.
		const map = rememberIn(rememberIn(rememberIn({}, 'a', '1.png'), 'b', '2.png'), 'a', '3.png');
		expect(Object.keys(map)).toEqual(['b', 'a']);
	});

	test('drops the oldest once the cap is reached', () => {
		let map: PopoutMemory = {};
		for (let i = 0; i < MEMORY_LIMIT + 3; i++) map = rememberIn(map, `c${i}`, `${i}.png`);
		expect(Object.keys(map)).toHaveLength(MEMORY_LIMIT);
		expect(map.c0).toBeUndefined();
		expect(map.c2).toBeUndefined();
		expect(map[`c${MEMORY_LIMIT + 2}`]).toBe(`${MEMORY_LIMIT + 2}.png`);
	});

	test('honours a smaller cap', () => {
		const map = rememberIn(rememberIn({ a: '1.png' }, 'b', '2.png'), 'c', '3.png', 2);
		expect(Object.keys(map)).toEqual(['b', 'c']);
	});
});

describe('forgetIn', () => {
	test('removes just that character', () => {
		expect(forgetIn({ a: '1.png', b: '2.png' }, 'a')).toEqual({ b: '2.png' });
	});

	test('a character with nothing remembered is not an error', () => {
		expect(forgetIn({ a: '1.png' }, 'z')).toEqual({ a: '1.png' });
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
		rememberPopout('char-1', 'images/gallery/one.png');
		expect(readPopoutMemory()).toEqual({ 'char-1': 'images/gallery/one.png' });
	});

	test('forgetting one leaves the others', () => {
		rememberPopout('char-1', 'one.png');
		rememberPopout('char-2', 'two.png');
		forgetPopout('char-1');
		expect(readPopoutMemory()).toEqual({ 'char-2': 'two.png' });
	});

	test('nothing saved reads as nothing', () => {
		expect(readPopoutMemory()).toEqual({});
	});

	test('a malformed record reads as nothing rather than throwing', () => {
		store.set('image-popout-by-character', '{not json');
		expect(readPopoutMemory()).toEqual({});
	});

	test('non-string entries are dropped, so nothing reopens on a number', () => {
		store.set('image-popout-by-character', JSON.stringify({ a: 'one.png', b: 7, c: null, d: '' }));
		expect(readPopoutMemory()).toEqual({ a: 'one.png' });
	});
});
