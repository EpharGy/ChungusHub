/**
 * Chorus: what reaches the prompt, decided once for every surface.
 *
 * The send (`prompt-builder.ts`) and the chat meter (`InputArea.svelte`) both build their
 * `AssembleInput.chorus` through `chorusForPrompt` and nothing else, the steering rule
 * (prompt-pipeline coupling 8): a meter resolving the block its own way prices a prompt the
 * send does not inject. Pure, so both can call it against their own copy of the chat.
 */
import type { SteeringRole } from '$lib/types/steering';
import {
	CHORUS_GOAL_KEYS,
	type ChorusChatState,
	type ChorusGoals,
	type ChorusMember,
	type ChorusReading,
	type ChorusReadings
} from './state';

/** The least of a message a path walk needs. */
interface PathTurn {
	id: string;
	role: string;
}

/** The app-wide half of the decision (Settings → Engines → Chorus). */
export interface ChorusPromptSettings {
	/** The engine switch. */
	enabled: boolean;
	/** The `chorusWrapper` template; `{{intentions}}` is where the lines go. */
	wrapper: string;
	depth: number;
	role: SteeringRole;
	/** How many replies back a reading may come from: 0 = only the newest reply's own. */
	staleLimit: number;
	/** Read every this-many replies (`repliesUntilRead`); 1 is every reply. */
	every: number;
}

/** What assembly is handed: the lines, and where they go. The wrapper is filled inside
 *  assembly, against the same context as the rest of the prompt. */
export interface ChorusPromptInput {
	intentions: string;
	wrapper: string;
	depth: number;
	role: SteeringRole;
}

export const CHORUS_STALE_LIMIT_MAX = 5;
export const CHORUS_EVERY_MAX = 10;

/**
 * How many replies after `replyId` the next scheduled read falls: 0 means this reply is read.
 *
 * Counted by the reply's position among the assistant turns on its path, the first reply
 * read and then every `every`-th after it. Position rather than a running counter because
 * it is the same for every sibling at that point: a swipe or a regenerate is read exactly
 * when the reply it replaced was, and walking to another branch needs no bookkeeping.
 */
export function repliesUntilRead(path: readonly PathTurn[], replyId: string, every: number): number {
	const step = Math.max(1, Math.round(every));
	let position = 0;
	for (const turn of path) {
		if (turn.role === 'assistant') position += 1;
		if (turn.id === replyId) break;
	}
	return (step - ((position - 1) % step)) % step;
}

/**
 * How far back a reading may come from, once the schedule is counted in. The replies between
 * scheduled reads are never read, so the reader's limit is counted from the last reply that
 * was meant to be: reading every third reply with a limit of 1 reaches back 3, past the two
 * skipped replies and one more for a read still in flight. At every reply it is the limit as set.
 */
export function effectiveStaleLimit(settings: Pick<ChorusPromptSettings, 'staleLimit' | 'every'>): number {
	return settings.staleLimit + Math.max(1, Math.round(settings.every)) - 1;
}

/**
 * The reading the next reply should use, and which reply it belongs to.
 *
 * Walks the path backwards over assistant turns: the newest reply is 0 back, the one before
 * it 1 back. The first reply holding a reading within `staleLimit` wins. A send made while a
 * run is still in flight therefore goes out with the reading before it, rather than waiting
 * or going out with nothing. Past the limit it is nothing: an old reading describes a scene
 * the story has left.
 */
export function readingFor(
	path: readonly PathTurn[],
	readings: ChorusReadings,
	staleLimit: number
): { messageId: string; reading: ChorusReading } | null {
	let back = 0;
	for (let i = path.length - 1; i >= 0; i--) {
		const turn = path[i];
		if (turn.role !== 'assistant') continue;
		if (back > staleLimit) return null;
		const reading = readings[turn.id];
		if (reading) return { messageId: turn.id, reading };
		back += 1;
	}
	return null;
}

/**
 * A member's goals as of the end of this path.
 *
 * A pinned goal is the reader's and always wins. Otherwise the newest reading on the path
 * that has this member speaks for them, at any distance: every reading stores the member's
 * full goal set, so the newest one is the whole answer. With no reading anywhere on the path,
 * the reader's own unpinned text is the starting point.
 *
 * Walking the PATH rather than the stored readings is what makes goals branch-correct: a
 * reading on another branch is never consulted, so a swipe or a walk to another branch moves
 * the goals with it at no cost.
 */
export function effectiveGoals(
	member: ChorusMember,
	path: readonly PathTurn[],
	readings: ChorusReadings
): ChorusGoals {
	let fromReading: ChorusGoals | null = null;
	for (let i = path.length - 1; i >= 0 && !fromReading; i--) {
		const turn = path[i];
		if (turn.role !== 'assistant') continue;
		const said = readings[turn.id]?.members.find((m) => m.memberId === member.id && !m.error);
		if (said) fromReading = said.goals;
	}
	const goals = { ...member.goals };
	for (const key of CHORUS_GOAL_KEYS) {
		if (member.pinned[key]) continue;
		if (fromReading && fromReading[key]) goals[key] = fromReading[key];
	}
	return goals;
}

/**
 * One labelled entry per member who has something to say, in roster order.
 *
 * Labels rather than a sentence stitched together: the agents answer in whole sentences of
 * their own ("Slides the ledger across and waits"), which no joining word reads well in front
 * of.
 *
 * Only members still on the roster AND switched on: muting someone takes them out of the next
 * prompt at once, without waiting for a run. A member whose call failed is left out rather
 * than sent as an error, and the panel says so instead.
 */
export function renderIntentions(reading: ChorusReading, state: ChorusChatState): string {
	const entries: string[] = [];
	for (const member of state.members) {
		if (!member.enabled) continue;
		const said = reading.members.find((m) => m.memberId === member.id);
		if (!said || said.error) continue;
		const lines = [`- ${member.name}`];
		if (said.want) lines.push(`  Wants: ${said.want}`);
		if (said.intends) lines.push(`  Would: ${said.intends}`);
		if (lines.length > 1) entries.push(lines.join('\n'));
	}
	return entries.join('\n');
}

/**
 * The block for the next reply, or undefined for none.
 *
 * Nothing when the engine is off, when this chat's own switch is off, or when no reading is
 * close enough. `path` is the path the reply is generated against: a send's ends on the user
 * turn just added, a regenerate's on the turn before the reply being replaced, and both find
 * the reply before that as their newest assistant turn, which is the one the agents read.
 */
export function chorusForPrompt(
	path: readonly PathTurn[],
	state: ChorusChatState,
	readings: ChorusReadings,
	settings: ChorusPromptSettings
): ChorusPromptInput | undefined {
	if (!settings.enabled || !state.enabled) return undefined;
	const found = readingFor(path, readings, effectiveStaleLimit(settings));
	if (!found) return undefined;
	const intentions = renderIntentions(found.reading, state);
	if (!intentions) return undefined;
	return { intentions, wrapper: settings.wrapper, depth: settings.depth, role: settings.role };
}
