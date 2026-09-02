/**
 * What the pop-out remembers per chat, pinned. The recency rule, the cap and the prune
 * decide whether a window you left open comes back weeks later, and none of them is visible
 * from the outside until one silently does not. Run with `bun test`.
 *
 * Two things are most worth pinning here. The key is the CHAT, not the character, so a
 * character with several stories running does not share one pinned picture between them. And
 * the key and the source are allowed to differ: the key is the story being read, the source
 * is whose gallery the picture came from, and conflating them is exactly the bug this shape
 * exists to prevent.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
	MEMORY_LIMIT,
	forgetIn,
	forgetPopout,
	pruneIn,
	prunePopoutMemory,
	readPopoutMemory,
	rememberIn,
	rememberPopout,
	type PopoutMemory
} from './popout-memory';

const one = { path: 'images/one.png', sourceId: 'src-1' };
const two = { path: 'images/two.png', sourceId: 'src-2' };

describe('rememberIn', () => {
	test('records a picture against the chat being read', () => {
		expect(rememberIn({}, 'a', one)).toEqual({ a: one });
	});

	test('keeps a source that is nobody in the chat keyed on', () => {
		// Character A's art, opened while reading a chat about B, belongs to that chat and is
		// found again in A's gallery. Both halves have to survive the round trip.
		const map = rememberIn({}, 'chat-b', { path: 'a.png', sourceId: 'char-a' });
		expect(map['chat-b']).toEqual({ path: 'a.png', sourceId: 'char-a' });
	});

	test('two chats of one character keep separate pictures', () => {
		// The whole point of keying on the chat: a reference pinned up in one story is not a
		// fact about every other story with the same character in it.
		const map = rememberIn(rememberIn({}, 'chat-1', one), 'chat-2', two);
		expect(map).toEqual({ 'chat-1': one, 'chat-2': two });
	});

	test('replaces the picture a chat was already on', () => {
		expect(rememberIn({ a: one }, 'a', two)).toEqual({ a: two });
	});

	test('leaves the source map alone', () => {
		const before: PopoutMemory = { a: one };
		rememberIn(before, 'b', two);
		expect(before).toEqual({ a: one });
	});

	test('moves a chat you return to back to the front of the queue', () => {
		// Assigning in place would leave `a` in its original slot, so a story opened daily
		// would still age out behind ones untouched for weeks.
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
	test('removes just that chat', () => {
		expect(forgetIn({ a: one, b: two }, 'a')).toEqual({ b: two });
	});

	test('a chat with nothing remembered is not an error', () => {
		expect(forgetIn({ a: one }, 'z')).toEqual({ a: one });
	});
});

describe('pruneIn', () => {
	test('drops records whose chat is gone', () => {
		expect(pruneIn({ a: one, b: two }, new Set(['a']))).toEqual({ a: one });
	});

	test('keeps every record whose chat is still there', () => {
		expect(pruneIn({ a: one, b: two }, new Set(['a', 'b']))).toEqual({ a: one, b: two });
	});

	test('an empty chat list drops everything', () => {
		// Reachable only with no chats at all, where there is nothing left to reopen into.
		expect(pruneIn({ a: one }, new Set())).toEqual({});
	});

	test('keeps a record whose SOURCE is gone, so its reader can still be told', () => {
		// A deleted gallery is not a reason to sweep here: that chat can still be walked back
		// into, and the reopen is what owes its reader the notice. Sweeping it silently would
		// take that notice away.
		expect(pruneIn({ 'chat-1': one }, new Set(['chat-1']))).toEqual({ 'chat-1': one });
	});

	test('leaves the source map alone', () => {
		const before: PopoutMemory = { a: one, b: two };
		pruneIn(before, new Set(['a']));
		expect(before).toEqual({ a: one, b: two });
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

	test('a remembered picture survives the round trip', () => {
		rememberPopout('chat-1', one);
		expect(readPopoutMemory()).toEqual({ 'chat-1': one });
	});

	test('forgetting one leaves the others', () => {
		rememberPopout('chat-1', one);
		rememberPopout('chat-2', two);
		forgetPopout('chat-1');
		expect(readPopoutMemory()).toEqual({ 'chat-2': two });
	});

	test('nothing saved reads as nothing', () => {
		expect(readPopoutMemory()).toEqual({});
	});

	test('a malformed record reads as nothing rather than throwing', () => {
		store.set('image-popout-by-chat', '{not json');
		expect(readPopoutMemory()).toEqual({});
	});

	test('half an entry is dropped, since a path with no source has no set to page', () => {
		store.set(
			'image-popout-by-chat',
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

	test('the character-keyed record this replaced is swept, not migrated', () => {
		// Turning it into a chat-keyed one would mean guessing which of that character's
		// chats the picture was pinned up in. Left in place it would sit in every reader's
		// browser forever, which is the one thing this record must not do.
		store.set('image-popout-by-character', JSON.stringify({ 'char-1': one }));
		readPopoutMemory();
		expect(store.has('image-popout-by-character')).toBe(false);
	});

	describe('prunePopoutMemory', () => {
		test('drops records for chats that are gone', () => {
			rememberPopout('chat-1', one);
			rememberPopout('chat-2', two);
			prunePopoutMemory(new Set(['chat-2']));
			expect(readPopoutMemory()).toEqual({ 'chat-2': two });
		});

		test('does not write when there is nothing to sweep', () => {
			// It runs off the live chat list, so it fires on every change to that list. The
			// ordinary case has to cost nothing.
			rememberPopout('chat-1', one);
			const before = writes;
			prunePopoutMemory(new Set(['chat-1']));
			expect(writes).toBe(before);
		});
	});
});
