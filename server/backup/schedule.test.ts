/**
 * When the unattended schedule fires, as a pure decision over time.
 *
 * The duplicates are the point: a snapshot the app took for another reason satisfies the
 * schedule for a whole interval, and an install nobody has written to does not get copied
 * again just because it was launched. Neither is checkable by looking at a running app, which
 * is why they are pinned here.
 */
import { describe, test, expect } from 'bun:test';
import { scheduleDecision } from './schedule';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

function decide(patch: Partial<Parameters<typeof scheduleDecision>[0]> = {}) {
	return scheduleDecision({
		now: NOW,
		newest: { createdAt: NOW - 25 * HOUR },
		changedAt: NOW - HOUR,
		intervalHours: 24,
		retryAfter: 0,
		...patch
	});
}

describe('the unattended schedule', () => {
	test('takes one when the interval has passed and the data moved', () => {
		expect(decide()).toEqual({ take: true, reason: 'due' });
	});

	test('a before-upgrade snapshot satisfies the schedule it landed next to', () => {
		// Boot upgrades the database, snapshots first, and the timer wakes fifteen seconds
		// later. Anchor the clock half on the last SCHEDULED snapshot and this is a second
		// identical copy, seconds after the first.
		const decision = decide({
			newest: { createdAt: NOW - 15_000 },
			changedAt: NOW - 5_000
		});
		expect(decision).toEqual({ take: false, reason: 'recent enough' });
	});

	test('a manual snapshot satisfies it too', () => {
		expect(decide({ newest: { createdAt: NOW - MINUTE } })).toEqual({
			take: false,
			reason: 'recent enough'
		});
	});

	test('an install nobody has written to since the last snapshot is left alone', () => {
		// The machine that is opened and closed daily without a word being typed. Answer this
		// from memory rather than from disk and every launch says "changed", which is a full
		// copy of the same database every day forever.
		expect(decide({ changedAt: NOW - 30 * HOUR })).toEqual({
			take: false,
			reason: 'nothing changed'
		});
	});

	test('a change that landed while the last snapshot was being written still counts', () => {
		// The snapshot is stamped when it STARTS, so anything written during the minutes it
		// takes is later than its stamp and is still owed a copy.
		expect(decide({ newest: { createdAt: NOW - 25 * HOUR }, changedAt: NOW - 25 * HOUR + 1000 })).toEqual(
			{ take: true, reason: 'due' }
		);
	});

	test('an empty store waits for the first edit rather than copying an empty install', () => {
		expect(decide({ newest: null, changedAt: 0 })).toEqual({ take: false, reason: 'nothing yet' });
	});

	test('the first edit on a fresh install starts the history at once', () => {
		expect(decide({ newest: null, changedAt: NOW - 1000 })).toEqual({ take: true, reason: 'due' });
	});

	test('holds off after a failure instead of spawning a job a minute', () => {
		expect(decide({ retryAfter: NOW + 5 * MINUTE })).toEqual({ take: false, reason: 'backing off' });
	});

	test('says so when a snapshot is stamped in the future', () => {
		// A clock behind the store answers neither question. Skipping quietly would stop
		// backups for as long as the gap lasts with nothing on screen admitting it.
		expect(decide({ newest: { createdAt: NOW + 3 * HOUR } })).toEqual({
			take: false,
			reason: 'clock behind the store'
		});
	});
});
