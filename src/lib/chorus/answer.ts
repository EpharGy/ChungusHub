/**
 * Chorus: turning one agent's reply into a stored answer.
 *
 * The JSON tolerance is the app's shared one (`parseJsonObject`, utils/json-extract.ts), not a
 * copy of the extension's: two engines with two notions of a valid answer is the thing that
 * helper exists to prevent.
 */
import { parseJsonObject } from '$lib/utils/json-extract';
import {
	CHORUS_GOAL_KEYS,
	CHORUS_LIMITS,
	type ChorusGoalKey,
	type ChorusGoals
} from './state';

export interface ChorusAnswer {
	want: string;
	intends: string;
	/** The member's goals after this answer: the ones it moved, over the ones it was given. */
	goals: ChorusGoals;
}

function text(raw: unknown, max: number): string {
	return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/**
 * Read an agent's reply, or null when it said nothing usable.
 *
 * `given` is the goal set the agent was shown and `pinned` the ones it may not move. A goal it
 * leaves out, or returns empty, keeps its given value: the template asks for changed goals
 * only, so silence means "unchanged", never "cleared". A pinned goal is the reader's, and an
 * agent proposing a new one is ignored rather than obeyed.
 *
 * Null when neither `want` nor `intends` came back, which is what a reply that ignored the
 * format looks like. That is a failure for the panel to show, not an empty member to inject.
 */
export function parseChorusAnswer(
	raw: string,
	given: ChorusGoals,
	pinned: Record<ChorusGoalKey, boolean>
): ChorusAnswer | null {
	const obj = parseJsonObject(raw);
	const want = text(obj.want, CHORUS_LIMITS.want);
	const intends = text(obj.intends, CHORUS_LIMITS.intends);
	if (!want && !intends) return null;

	const proposed =
		obj.goals && typeof obj.goals === 'object' ? (obj.goals as Record<string, unknown>) : {};
	const goals = { ...given };
	for (const key of CHORUS_GOAL_KEYS) {
		if (pinned[key]) continue;
		const next = text(proposed[key], CHORUS_LIMITS.goal);
		if (next) goals[key] = next;
	}
	return { want, intends, goals };
}
