/**
 * The deck's drop rules: a card that cannot fill its page is not offered at all. Pinned
 * because the failure mode is silent and looks like design: a heading over empty space
 * reads as a picture that failed to load, and nobody reports a card they never saw they
 * were missing.
 */
import { describe, it, expect } from 'bun:test';
import { posterCards } from './poster';
import type { StatsSnapshot } from '$lib/stores/stats.svelte';
import type { UserStats, StatsCastMember } from '$lib/types/stats';

const DAY = 24 * 3600_000;

function volume(overrides: Partial<UserStats['effort']> = {}): UserStats['effort'] {
	return {
		messages: 0,
		userMessages: 0,
		assistantMessages: 0,
		words: 0,
		userWords: 0,
		assistantWords: 0,
		...overrides
	};
}

function member(id: string): StatsCastMember {
	return { characterId: id, chats: 1, messages: 10, words: 100, firstAt: DAY, lastAt: DAY * 2 };
}

/** A library with enough of everything that every card qualifies. Tests knock pieces out. */
function full(): StatsSnapshot {
	const stats: UserStats = {
		library: { chats: 3, characters: 2, personas: 1, lorebooks: 0, lorebookEntries: 0, memoryEpisodes: 0 },
		effort: volume({ messages: 40, userMessages: 20, assistantMessages: 20, words: 4000, userWords: 1500, assistantWords: 2500 }),
		story: volume({ messages: 30, words: 3000 }),
		activity: [[DAY, 4]],
		cast: [member('a'), member('b')],
		shape: { abandoned: 10, longestStory: 25 },
		records: {
			longestReply: { chatId: 'c', words: 900 },
			longestUserTurn: { chatId: 'c', words: 300 },
			longestChat: { chatId: 'c', messages: 25 },
			firstMessageAt: DAY,
			lastMessageAt: DAY * 3
		},
		measured: {
			promptTokens: 0,
			promptTokenTurns: 0,
			completionTokens: 0,
			completionTokenTurns: 0,
			generationMs: 0,
			generationTurns: 0,
			firstTokenMs: 0,
			firstTokenTurns: 0,
			reasoningMs: 0,
			reasoningTurns: 0,
			assistantTurns: 20
		}
	};
	return {
		stats,
		takenAt: DAY * 4,
		days: [
			{ key: '1970-01-02', at: DAY, count: 4 },
			{ key: '1970-01-03', at: DAY * 2, count: 2 }
		],
		longest: { days: 2, from: '1970-01-02', to: '1970-01-03' },
		current: { days: 0, from: null, to: null },
		hours: new Array<number>(24).fill(0),
		busiest: { key: '1970-01-02', at: DAY, count: 4 },
		prime: null
	};
}

const NAMES = { a: 'Alice', b: 'Bram' };

function ids(snapshot: StatsSnapshot, names: Record<string, string>): string[] {
	return posterCards(snapshot, names).map((c) => c.id);
}

describe('the deck offers every card the snapshot can fill, in a fixed order', () => {
	it('deals all four on a full library', () => {
		expect(ids(full(), NAMES)).toEqual(['writing', 'cast', 'time', 'records']);
	});

	it('always deals the writing card', () => {
		const bare = full();
		bare.days = [];
		bare.stats.cast = [];
		expect(ids(bare, {})).toContain('writing');
	});
});

describe('the cast card needs a face it can name', () => {
	it('is dropped when no counted character is still in the library', () => {
		expect(ids(full(), {})).not.toContain('cast');
	});

	it('survives on a single named member', () => {
		const one = full();
		one.stats.cast = [member('a')];
		expect(ids(one, { a: 'Alice' })).toContain('cast');
	});
});

describe('the time card needs at least one active day', () => {
	it('is dropped on an empty calendar', () => {
		const quiet = full();
		quiet.days = [];
		expect(ids(quiet, NAMES)).not.toContain('time');
	});
});

describe('the records card needs a full page of superlatives', () => {
	it('is dropped when fewer than five records exist', () => {
		const thin = full();
		// No abandoned turns and no multi-day run leaves four entries, one short of a page.
		thin.stats.shape.abandoned = 0;
		thin.longest = { days: 1, from: '1970-01-02', to: '1970-01-02' };
		expect(ids(thin, NAMES)).not.toContain('records');
	});

	it('is dropped without a first-words date, which anchors the page', () => {
		const undated = full();
		undated.stats.records.firstMessageAt = null;
		expect(ids(undated, NAMES)).not.toContain('records');
	});
});
