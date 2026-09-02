/**
 * Which chats the notepad reopens for, pinned. The recency rule and the cap decide whether a
 * window you left standing comes back weeks later, and neither is visible from the outside
 * until it silently does not. Run with `bun test`.
 *
 * What is worth pinning here is that this record holds NO notes. It is presence and nothing
 * else; the writing lives on the chat row. A test that started asserting text in here would
 * be the first sign the two had been confused.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
	MEMORY_LIMIT,
	forgetIn,
	forgetNotepadOpen,
	isNotepadOpenFor,
	pruneIn,
	pruneNotepadMemory,
	readNotepadMemory,
	rememberIn,
	rememberNotepadOpen,
	type NotepadMemory
} from './notepad-memory';

describe('rememberIn', () => {
	test('records a chat as having its notepad open', () => {
		expect(rememberIn([], 'a')).toEqual(['a']);
	});

	test('records a chat once, however many times it is opened', () => {
		expect(rememberIn(rememberIn([], 'a'), 'a')).toEqual(['a']);
	});

	test('leaves the source list alone', () => {
		const before: NotepadMemory = ['a'];
		rememberIn(before, 'b');
		expect(before).toEqual(['a']);
	});

	test('moves a chat you return to back to the front of the queue', () => {
		// Left in place, a story opened daily would age out behind ones untouched for weeks.
		expect(rememberIn(rememberIn(rememberIn([], 'a'), 'b'), 'a')).toEqual(['b', 'a']);
	});

	test('drops the oldest once the cap is reached', () => {
		let list: NotepadMemory = [];
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
		const before: NotepadMemory = ['a', 'b'];
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

	test('an open notepad survives the round trip', () => {
		rememberNotepadOpen('chat-1');
		expect(isNotepadOpenFor('chat-1')).toBe(true);
	});

	test('a chat nobody opened one in reads as closed', () => {
		rememberNotepadOpen('chat-1');
		expect(isNotepadOpenFor('chat-2')).toBe(false);
	});

	test('forgetting one leaves the others', () => {
		rememberNotepadOpen('chat-1');
		rememberNotepadOpen('chat-2');
		forgetNotepadOpen('chat-1');
		expect(readNotepadMemory()).toEqual(['chat-2']);
	});

	test('nothing saved reads as nothing', () => {
		expect(readNotepadMemory()).toEqual([]);
	});

	test('a malformed record reads as nothing rather than throwing', () => {
		store.set('notepad-open-chats', '[not json');
		expect(readNotepadMemory()).toEqual([]);
	});

	test('a record of the wrong shape reads as nothing', () => {
		// The pop-out's key holds an object; reading one of those here must not produce a
		// list of its keys, which would reopen windows for ids that mean something else.
		store.set('notepad-open-chats', JSON.stringify({ 'chat-1': true }));
		expect(readNotepadMemory()).toEqual([]);
	});

	test('junk entries are dropped and the good ones kept', () => {
		store.set('notepad-open-chats', JSON.stringify(['chat-1', '', 3, null, 'chat-2']));
		expect(readNotepadMemory()).toEqual(['chat-1', 'chat-2']);
	});

	describe('pruneNotepadMemory', () => {
		test('drops ids for chats that are gone', () => {
			rememberNotepadOpen('chat-1');
			rememberNotepadOpen('chat-2');
			pruneNotepadMemory(new Set(['chat-2']));
			expect(readNotepadMemory()).toEqual(['chat-2']);
		});

		test('does not write when there is nothing to sweep', () => {
			// It runs off the live chat list, so it fires on every change to that list. The
			// ordinary case has to cost nothing.
			rememberNotepadOpen('chat-1');
			const before = writes;
			pruneNotepadMemory(new Set(['chat-1']));
			expect(writes).toBe(before);
		});
	});
});
