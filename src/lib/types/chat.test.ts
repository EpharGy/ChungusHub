/**
 * Tests for the chat feature-state normalizer (the steering reuse history +
 * impersonate). Run with `bun test`. Pure logic only (no store, no Svelte runtime)
 * since both the chatStore reactive path and the (db-sourced) generation path call this
 * same function and must agree on what a corrupt or missing value degrades to.
 * The steering notes themselves live in their own table; see steering.test.ts.
 */

import { describe, expect, test } from 'bun:test';

import { DEFAULT_CHAT_FEATURE_STATE, normalizeChatFeatureState, pushSteeringHistoryEntry } from './chat';

describe('normalizeChatFeatureState: degrading to defaults', () => {
	test('null degrades to the defaults', () => {
		expect(normalizeChatFeatureState(null)).toEqual(DEFAULT_CHAT_FEATURE_STATE);
	});

	test('undefined degrades to the defaults', () => {
		expect(normalizeChatFeatureState(undefined)).toEqual(DEFAULT_CHAT_FEATURE_STATE);
	});

	test('malformed JSON string degrades to the defaults', () => {
		expect(normalizeChatFeatureState('{not json')).toEqual(DEFAULT_CHAT_FEATURE_STATE);
	});

	test('a non-object value (e.g. a bare number) degrades to the defaults', () => {
		expect(normalizeChatFeatureState(42)).toEqual(DEFAULT_CHAT_FEATURE_STATE);
	});

	test('an empty object degrades every field to its default', () => {
		expect(normalizeChatFeatureState({})).toEqual(DEFAULT_CHAT_FEATURE_STATE);
	});
});

describe('normalizeChatFeatureState: the JSON column value', () => {
	test('parses a JSON string (the normal wire shape)', () => {
		const raw = JSON.stringify({
			steeringHistory: ['earlier note'],
			impersonatePerspective: 'third'
		});
		expect(normalizeChatFeatureState(raw)).toEqual({
			steeringHistory: ['earlier note'],
			impersonatePerspective: 'third'
		});
	});

	test('accepts an already-parsed object directly', () => {
		const value = {
			steeringHistory: ['x'],
			impersonatePerspective: 'second' as const
		};
		expect(normalizeChatFeatureState(value)).toEqual(value);
	});

	test('a legacy blob\'s `steering` object is ignored, not carried', () => {
		// Steering notes are their own rows (types/steering.ts). A blob still carrying the
		// single-steering key must simply stop being parsed: nothing migrates it, and it
		// drops on that chat's next feature-state write.
		const result = normalizeChatFeatureState({
			steering: { text: 'be terse', mode: 'pinned', depth: 3, role: 'system' },
			steeringHistory: ['earlier note'],
			impersonatePerspective: 'third'
		});
		expect(result).toEqual({ steeringHistory: ['earlier note'], impersonatePerspective: 'third' });
		expect('steering' in result).toBe(false);
	});
});

describe('normalizeChatFeatureState: steeringHistory', () => {
	test('drops non-string and empty-string entries', () => {
		const result = normalizeChatFeatureState({
			steeringHistory: ['keep me', '', 7, null, 'also keep']
		});
		expect(result.steeringHistory).toEqual(['keep me', 'also keep']);
	});

	test('caps at 10 entries', () => {
		const history = Array.from({ length: 15 }, (_, i) => `entry ${i}`);
		const result = normalizeChatFeatureState({ steeringHistory: history });
		expect(result.steeringHistory).toHaveLength(10);
		expect(result.steeringHistory).toEqual(history.slice(0, 10));
	});

	test('a non-array value degrades to an empty history', () => {
		const result = normalizeChatFeatureState({ steeringHistory: 'not an array' });
		expect(result.steeringHistory).toEqual([]);
	});
});

describe('normalizeChatFeatureState: impersonatePerspective', () => {
	test('passes through a valid perspective', () => {
		expect(normalizeChatFeatureState({ impersonatePerspective: 'second' }).impersonatePerspective).toBe('second');
	});

	test('an invalid perspective whitelists down to first', () => {
		expect(normalizeChatFeatureState({ impersonatePerspective: 'omniscient' }).impersonatePerspective).toBe(
			'first'
		);
	});
});

describe('pushSteeringHistoryEntry', () => {
	test('pushes onto an empty history', () => {
		expect(pushSteeringHistoryEntry([], 'first note')).toEqual(['first note']);
	});

	test('adds a new entry to the front, keeping older ones behind it', () => {
		expect(pushSteeringHistoryEntry(['older'], 'newer')).toEqual(['newer', 'older']);
	});

	test('an exact duplicate moves to the front instead of duplicating', () => {
		expect(pushSteeringHistoryEntry(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
	});

	test('caps the result at 10 entries', () => {
		const history = Array.from({ length: 10 }, (_, i) => `entry ${i}`);
		const result = pushSteeringHistoryEntry(history, 'new entry');
		expect(result).toHaveLength(10);
		expect(result[0]).toBe('new entry');
		expect(result[result.length - 1]).toBe('entry 8');
	});
});
