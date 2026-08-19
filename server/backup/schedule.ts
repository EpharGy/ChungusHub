/**
 * Whether an unattended snapshot is due, as a pure decision over what is already on disk.
 *
 * One rule, and both halves of it hang off the SAME anchor (the newest snapshot in the
 * store, whatever kind it is):
 *
 *   Take a scheduled snapshot when nothing has been snapshotted in the last interval, and
 *   something has changed since whatever was.
 *
 * That shared anchor is what stops the duplicates. A snapshot taken because the database was
 * about to be upgraded, or because a person pressed the button, already holds everything up
 * to the moment it started, so the schedule has nothing to add for a whole interval after it.
 * Anchoring the clock half on the last SCHEDULED snapshot instead writes a second identical
 * copy fifteen seconds after every boot that upgrades, and a minute after every manual one.
 *
 * The change half is a timestamp rather than a flag, which is what makes it safe across a
 * restart and across a job: a change that lands WHILE a snapshot is being written is later
 * than that snapshot's own stamp, so it still reads as pending. There is nothing to clear and
 * therefore no clearing to get wrong.
 *
 * Pure and tested like `retention.ts`, because every clause here is a sentence about time and
 * none of them can be checked by looking at a running app.
 */

export interface ScheduleInputs {
	now: number;
	/** The newest snapshot in the store, of ANY kind, or null while the store is empty. */
	newest: { createdAt: number } | null;
	/** When the data last changed. 0 means nothing has ever been written to this install. */
	changedAt: number;
	intervalHours: number;
	/** Set after a failed attempt, so a full disk is not retried once a minute forever. */
	retryAfter: number;
}

export type ScheduleReason =
	| 'due'
	| 'backing off'
	| 'recent enough'
	| 'nothing changed'
	| 'nothing yet'
	| 'clock behind the store';

export interface ScheduleDecision {
	take: boolean;
	reason: ScheduleReason;
}

export function scheduleDecision(input: ScheduleInputs): ScheduleDecision {
	const { now, newest, changedAt, intervalHours, retryAfter } = input;

	if (now < retryAfter) return { take: false, reason: 'backing off' };

	// A snapshot stamped after this moment leaves both questions unanswerable: neither "is
	// there a recent one" nor "is it older than the change" means anything while the clock
	// disagrees with the store. Named rather than folded into a skip, because the service puts
	// this one on the page. A schedule that quietly stops is the failure nobody notices.
	if (newest && newest.createdAt > now) return { take: false, reason: 'clock behind the store' };

	// A fresh install has nothing to copy. The first real edit is what starts the history.
	if (changedAt <= 0) return { take: false, reason: 'nothing yet' };

	if (!newest) return { take: true, reason: 'due' };
	if (now - newest.createdAt < intervalHours * 3_600_000) {
		return { take: false, reason: 'recent enough' };
	}
	if (changedAt <= newest.createdAt) return { take: false, reason: 'nothing changed' };
	return { take: true, reason: 'due' };
}
