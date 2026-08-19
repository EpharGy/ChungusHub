/**
 * The stats screen's data, loaded on demand and never on boot.
 *
 * `getUserStats` reads every message body in the database to produce its numbers, so it is
 * the most expensive read the app has. Nothing may call it on a render, on a sync hint, or
 * anywhere in `boot()`: the panel asks when it opens, and that is the only door.
 *
 * The figures are a snapshot of the moment they were asked for, deliberately. They are not
 * re-derived when a message lands, because a screen whose headline number twitches while
 * you are reading it is a screen nobody trusts, and because the answer costs a full pass.
 * The panel says when the snapshot was taken and offers a refresh instead.
 */
import { db } from '$lib/services/database';
import type { UserStats } from '$lib/types/stats';
import {
	toActiveDays,
	longestStreak,
	currentStreak,
	hourHistogram,
	busiestDay,
	primeHours,
	type ActiveDay,
	type Streak
} from '$lib/stats/derive';

/** Everything the screen reads: the server's aggregate plus what the client works out of
 *  it in the reader's own time zone. One object, so a half-updated screen is unexpressible. */
export interface StatsSnapshot {
	stats: UserStats;
	/** When the aggregate was taken. The screen dates its poster from this, never from now. */
	takenAt: number;
	days: ActiveDay[];
	longest: Streak;
	current: Streak;
	hours: number[];
	busiest: ActiveDay | null;
	prime: [number, number] | null;
}

class StatsStore {
	snapshot = $state<StatsSnapshot | null>(null);
	loading = $state(false);
	/** The failure, kept on screen rather than toasted away: this panel has nothing else to
	 *  show, so a silent empty state would read as an empty library. */
	error = $state<string | null>(null);

	/**
	 * Load, unless a snapshot is already in hand. The panel calls this every time it opens
	 * and pays for the pass once; `refresh()` is the reader asking for a new one.
	 */
	async load(): Promise<void> {
		if (this.snapshot || this.loading) return;
		await this.refresh();
	}

	async refresh(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const stats = await db.getUserStats();
			const days = toActiveDays(stats.activity);
			const hours = hourHistogram(stats.activity);
			const takenAt = Date.now();
			this.snapshot = {
				stats,
				takenAt,
				days,
				longest: longestStreak(days),
				current: currentStreak(days, takenAt),
				hours,
				busiest: busiestDay(days),
				prime: primeHours(hours)
			};
		} catch (error) {
			this.snapshot = null;
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}
}

export const statsStore = new StatsStore();
