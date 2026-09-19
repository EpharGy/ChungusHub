/**
 * Which chats the gallery window reopens for, pinned. The recency rule, the cap and the
 * prune decide whether a window you left standing comes back weeks later, and none of them
 * is visible from the outside until one silently does not. Run with `bun test`.
 *
 * What is most worth pinning here is that this record holds NO picture. It is presence and
 * nothing else; the pinned image lives on the chat row (`feature_state.galleryPin`). A test
 * that started asserting a path in here would be the first sign the two had been confused
 * again - they were, once, and a picture pinned on a desktop was invisible from the phone
 * for exactly as long as this file was the only place it lived.
 *
 * The legacy sweep is tested for the same reason: both dead keys held objects, so a reader
 * of this list has to be sure it can never be handed one.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
	MEMORY_LIMIT,
	forgetIn,
	forgetPopoutOpen,
	isPopoutOpenFor,
	pruneIn,
	prunePopoutMemory,
	readPopoutMemory,
	rememberIn,
	rememberPopoutOpen,
	type PopoutMemory
} from './popout-memory';

describe('rememberIn', () => {
	test('records a chat as having its gallery window standing', () => {
		expect(rememberIn([], 'a')).toEqual(['a']);
	});

	test('records a chat once, however many times it is opened', () => {
		expect(rememberIn(rememberIn([], 'a'), 'a')).toEqual(['a']);
	});

	test('leaves the source list alone', () => {
		const before: PopoutMemory = ['a'];
		rememberIn(before, 'b');
		expect(before).toEqual(['a']);
	});

	test('two chats of one character are remembered separately', () => {
		// The whole point of keying on the chat: a window left up in one story is not a fact
		// about every other story with the same character in it.
		expect(rememberIn(rememberIn([], 'chat-1'), 'chat-2')).toEqual(['chat-1', 'chat-2']);
	});

	test('moves a chat you return to back to the front of the queue', () => {
		// Left in place, a story opened daily would age out behind ones untouched for weeks.
		expect(rememberIn(rememberIn(rememberIn([], 'a'), 'b'), 'a')).toEqual(['b', 'a']);
	});

	test('drops the oldest once the cap is reached', () => {
		let list: PopoutMemory = [];
		for (let i = 0; i < MEMORY_LIMIT + 3; i++) list = rememberIn(list, `c${i}`);
		expect(list).toHaveLength(MEMORY_LIMIT);
		expect(list).not.toContain('c0');
		expect(list).not.toContain('c2');
		expect(list).toContain(`c${MEMORY_LIMIT + 2}`);
	});

	test('honours a smaller cap', () => {
		expect(rememberIn(rememberIn(['a'], 'b'), 'c', 2)).toEqual(['b', 'c']);
	});
});

describe('forgetIn', () => {
	test('removes just that chat', () => {
		expect(forgetIn(['a', 'b'], 'a')).toEqual(['b']);
	});

	test('a chat with nothing remembered is not an error', () => {
		expect(forgetIn(['a'], 'z')).toEqual(['a']);
	});
});

describe('pruneIn', () => {
	test('drops ids whose chat is gone', () => {
		expect(pruneIn(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual(['a', 'c']);
	});

	test('keeps every id whose chat is still there', () => {
		expect(pruneIn(['a', 'b'], new Set(['a', 'b']))).toEqual(['a', 'b']);
	});

	test('keeps the recency order of what survives', () => {
		// The order IS the record: sweeping must not quietly re-age what it leaves behind.
		expect(pruneIn(['a', 'b', 'c'], new Set(['c', 'a']))).toEqual(['a', 'c']);
	});

	test('an empty chat list drops everything', () => {
		expect(pruneIn(['a'], new Set())).toEqual([]);
	});

	test('leaves the source list alone', () => {
		const before: PopoutMemory = ['a', 'b'];
		pruneIn(before, new Set(['a']));
		expect(before).toEqual(['a', 'b']);
	});
});

describe('storage', () => {
	let store: Map<string, string>;
	let writes: number;
	const original = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		store = new Map();
		writes = 0;
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => {
				writes++;
				store.set(k, v);
			},
			removeItem: (k: string) => void store.delete(k)
		};
	});

	afterEach(() => {
		(globalThis as { localStorage?: unknown }).localStorage = original;
	});

	test('a standing window survives the round trip', () => {
		rememberPopoutOpen('chat-1');
		expect(isPopoutOpenFor('chat-1')).toBe(true);
	});

	test('a chat nobody opened one in reads as closed', () => {
		rememberPopoutOpen('chat-1');
		expect(isPopoutOpenFor('chat-2')).toBe(false);
	});

	test('forgetting one leaves the others', () => {
		rememberPopoutOpen('chat-1');
		rememberPopoutOpen('chat-2');
		forgetPopoutOpen('chat-1');
		expect(readPopoutMemory()).toEqual(['chat-2']);
	});

	test('nothing saved reads as nothing', () => {
		expect(readPopoutMemory()).toEqual([]);
	});

	test('a malformed record reads as nothing rather than throwing', () => {
		store.set('image-popout-open-chats', '[not json');
		expect(readPopoutMemory()).toEqual([]);
	});

	test('a record of the wrong shape reads as nothing', () => {
		// This key held an object in two earlier shapes, and both are still out there. Reading
		// one must not produce a list of its keys, which would stand windows up for ids that
		// meant something else entirely.
		store.set('image-popout-open-chats', JSON.stringify({ 'chat-1': { open: true } }));
		expect(readPopoutMemory()).toEqual([]);
	});

	test('junk entries are dropped and the good ones kept', () => {
		store.set('image-popout-open-chats', JSON.stringify(['chat-1', '', 3, null, 'chat-2']));
		expect(readPopoutMemory()).toEqual(['chat-1', 'chat-2']);
	});

	test('both dead keys are swept on read', () => {
		// The character-keyed shape, and the chat-keyed one that wrongly held the picture.
		// Neither is migrated: promoting a stored path onto a chat row can only happen inside
		// that loaded chat, so it would land one story at a time and could never be declared
		// finished. Sweeping is what stops them sitting in a browser forever.
		store.set('image-popout-by-character', JSON.stringify({ 'char-1': { path: 'a.png' } }));
		store.set('image-popout-by-chat', JSON.stringify({ 'chat-1': { path: 'a.png' } }));
		readPopoutMemory();
		expect(store.has('image-popout-by-character')).toBe(false);
		expect(store.has('image-popout-by-chat')).toBe(false);
	});

	test('sweeping a dead key does not disturb the live one', () => {
		rememberPopoutOpen('chat-1');
		store.set('image-popout-by-chat', JSON.stringify({ 'chat-9': { path: 'a.png' } }));
		expect(readPopoutMemory()).toEqual(['chat-1']);
	});

	describe('prunePopoutMemory', () => {
		test('drops ids for chats that are gone', () => {
			rememberPopoutOpen('chat-1');
			rememberPopoutOpen('chat-2');
			prunePopoutMemory(new Set(['chat-2']));
			expect(readPopoutMemory()).toEqual(['chat-2']);
		});

		test('does not write when there is nothing to sweep', () => {
			// It runs off the live chat list, so it fires on every change to that list. The
			// ordinary case has to cost nothing.
			rememberPopoutOpen('chat-1');
			const before = writes;
			prunePopoutMemory(new Set(['chat-1']));
			expect(writes).toBe(before);
		});
	});
});
