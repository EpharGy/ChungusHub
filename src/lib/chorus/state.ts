/**
 * Chorus: what a chat keeps for it, and the rules that keep it small.
 *
 * Two slices of `ChatFeatureState`, deliberately separate keys:
 *
 * - `chorus` is the ROSTER: who is on the chat's list, whether they run, and the goals the
 *   reader wrote or pinned. Only the reader writes it.
 * - `chorusReadings` is what the agents said, by the id of the reply they read. Only a run
 *   writes it.
 *
 * Two keys rather than one object because `chatStore.updateChatFeatureState` merges a patch
 * at the top level. A run finishing while the reader renames somebody would otherwise write
 * back a roster it read before the rename, or the rename would write back readings from
 * before the run. Separate keys make that collision impossible rather than unlikely.
 *
 * **Why the chat row and not a column on `messages`.** A reading belongs to a reply, so a
 * message column is the obvious home, and it is the wrong one for a branch that never goes
 * upstream: the schema is versioned (`MIGRATIONS` in server/db.ts), and a fork-only migration
 * claims a version number upstream will one day use for something else, at which point the
 * NAS database believes upstream's migration has already run. EchoChamber stores its feeds
 * here for the same reason (echochamber/feed-state.ts). What it costs is size: the blob rides
 * every chat-list fetch, so readings are capped and pruned (`putReading`).
 *
 * Pure and store-free, so the generation path (reading the db) and the panel (reading the
 * store) normalize identically. See architecture/chorus.md.
 */

/** The three goal horizons, in the order every surface shows them. */
export const CHORUS_GOAL_KEYS = ['immediate', 'shortTerm', 'longTerm'] as const;
export type ChorusGoalKey = (typeof CHORUS_GOAL_KEYS)[number];

export type ChorusGoals = Record<ChorusGoalKey, string>;

export interface ChorusMember {
	id: string;
	/** What the agent is told it is, and the name its lorebook entry fires on. */
	name: string;
	/** Off keeps the member and their goals on the list without running them. */
	enabled: boolean;
	/** The reader's own goals. A pinned one always wins; an unpinned one is a starting
	 *  point the agents may move (see `effectiveGoals`, chorus/resolve.ts). */
	goals: ChorusGoals;
	pinned: Record<ChorusGoalKey, boolean>;
}

/** The roster slice (`ChatFeatureState.chorus`). */
export interface ChorusChatState {
	/** This chat's own switch. A roster can sit here switched off, and the app-wide engine
	 *  switch is a separate gate above it. */
	enabled: boolean;
	members: ChorusMember[];
}

/** One member's answer, as stored. */
export interface ChorusMemberReading {
	memberId: string;
	/** Copied at read time, so renaming a member later does not rewrite what was said. */
	name: string;
	want: string;
	intends: string;
	/** The member's goals AFTER this reading: every key, not only the ones that moved. A
	 *  full set is what lets the newest reading on a path answer on its own once older ones
	 *  have been pruned away. */
	goals: ChorusGoals;
	/** Set when this member's call failed or answered nothing usable. Nothing else on the
	 *  entry is then meaningful, and the prompt leaves the member out. */
	error?: string;
}

export interface ChorusReading {
	at: number;
	members: ChorusMemberReading[];
}

/** The readings slice (`ChatFeatureState.chorusReadings`), by the id of the reply read. */
export type ChorusReadings = Record<string, ChorusReading>;

/** A roster longer than this is a cost nobody meant: every member is a call per reply. */
export const CHORUS_MAX_MEMBERS = 8;

/**
 * How many readings one chat keeps.
 *
 * What is actually read: the newest reply's reading, the one before it while a run is in
 * flight (`staleLimit`), the goals off the newest reading on the path, and a couple more so
 * swiping between siblings and back does not re-bill the reader. Eight covers all of that.
 * The worst case is eight members with every field at its clamp, about 35KB, and an ordinary
 * chat of three short answers is nearer 4KB.
 */
export const CHORUS_MAX_READINGS = 8;

/** Field clamps. The agent is asked for one or two sentences; these are backstops for a
 *  model that ignored that, sized so a full blob stays inside the figure above. */
export const CHORUS_LIMITS = {
	name: 80,
	want: 300,
	intends: 600,
	goal: 300,
	error: 300
} as const;

export function emptyChorusGoals(): ChorusGoals {
	return { immediate: '', shortTerm: '', longTerm: '' };
}

function noPins(): Record<ChorusGoalKey, boolean> {
	return { immediate: false, shortTerm: false, longTerm: false };
}

export function defaultChorusChatState(): ChorusChatState {
	return { enabled: false, members: [] };
}

function clampText(raw: unknown, max: number): string {
	return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

function normalizeGoals(raw: unknown): ChorusGoals {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const goals = emptyChorusGoals();
	for (const key of CHORUS_GOAL_KEYS) goals[key] = clampText(obj[key], CHORUS_LIMITS.goal);
	return goals;
}

function normalizePins(raw: unknown): Record<ChorusGoalKey, boolean> {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const pins = noPins();
	for (const key of CHORUS_GOAL_KEYS) pins[key] = obj[key] === true;
	return pins;
}

function normalizeMember(raw: unknown): ChorusMember | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	const id = typeof obj.id === 'string' ? obj.id : '';
	const name = clampText(obj.name, CHORUS_LIMITS.name);
	if (!id || !name) return null;
	return {
		id,
		name,
		enabled: obj.enabled !== false,
		goals: normalizeGoals(obj.goals),
		pinned: normalizePins(obj.pinned)
	};
}

/** The roster as stored. Absent in every blob written before Chorus existed, which reads
 *  as switched off with nobody on it, so nothing migrates. A duplicate id keeps its first
 *  entry: two members sharing an id would share one reading and one set of goals. */
export function normalizeChorusChatState(raw: unknown): ChorusChatState {
	if (!raw || typeof raw !== 'object') return defaultChorusChatState();
	const obj = raw as Record<string, unknown>;
	const seen = new Set<string>();
	const members: ChorusMember[] = [];
	for (const entry of Array.isArray(obj.members) ? obj.members : []) {
		const member = normalizeMember(entry);
		if (!member || seen.has(member.id)) continue;
		seen.add(member.id);
		members.push(member);
		if (members.length === CHORUS_MAX_MEMBERS) break;
	}
	return { enabled: obj.enabled === true, members };
}

function normalizeMemberReading(raw: unknown): ChorusMemberReading | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	const memberId = typeof obj.memberId === 'string' ? obj.memberId : '';
	if (!memberId) return null;
	const error = clampText(obj.error, CHORUS_LIMITS.error);
	const reading: ChorusMemberReading = {
		memberId,
		name: clampText(obj.name, CHORUS_LIMITS.name),
		want: clampText(obj.want, CHORUS_LIMITS.want),
		intends: clampText(obj.intends, CHORUS_LIMITS.intends),
		goals: normalizeGoals(obj.goals)
	};
	if (error) reading.error = error;
	// An answer with nothing in it and no error says nothing; dropping it keeps the panel
	// from showing a member who apparently spoke and said nothing at all.
	if (!reading.error && !reading.want && !reading.intends) return null;
	return reading;
}

function normalizeReading(raw: unknown): ChorusReading | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	const members = Array.isArray(obj.members)
		? obj.members.map(normalizeMemberReading).filter((m): m is ChorusMemberReading => m !== null)
		: [];
	if (members.length === 0) return null;
	return {
		at: typeof obj.at === 'number' && Number.isFinite(obj.at) ? obj.at : 0,
		members
	};
}

/** The readings as stored. Same contract as the rest of the feature state: anything corrupt
 *  degrades to nothing rather than throwing, since a bad blob must never fail a chat read. */
export function normalizeChorusReadings(raw: unknown): ChorusReadings {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const readings: ChorusReadings = {};
	for (const [messageId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!messageId) continue;
		const reading = normalizeReading(value);
		if (reading) readings[messageId] = reading;
	}
	return readings;
}

/**
 * File a reading, pruning in the same write: first every reading whose reply no longer
 * exists anywhere in the chat, then the oldest until the cap is met.
 *
 * The first half closes a leak the storage choice leaves open. Deleting a chat takes its
 * readings with it, but deleting one reply (or a subtree) leaves its reading behind under an
 * id nothing resolves, holding a slot a live reply should have. `liveIds` is every message in
 * the chat, not the active path: a reading on another branch is not stale, just unwatched.
 */
export function putReading(
	readings: ChorusReadings,
	messageId: string,
	reading: ChorusReading,
	liveIds: Iterable<string>
): ChorusReadings {
	const live = new Set(liveIds);
	live.add(messageId);
	const kept = Object.entries({ ...readings, [messageId]: reading }).filter(([id]) => live.has(id));
	kept.sort((a, b) => b[1].at - a[1].at);
	return Object.fromEntries(kept.slice(0, CHORUS_MAX_READINGS));
}

/** Forget one reply's reading, so the next look at it runs the agents again. */
export function clearReading(readings: ChorusReadings, messageId: string): ChorusReadings {
	if (!(messageId in readings)) return readings;
	const next = { ...readings };
	delete next[messageId];
	return next;
}

/** A new member, named and running, with no goals yet. */
export function makeChorusMember(id: string, name: string): ChorusMember {
	return {
		id,
		name: name.trim().slice(0, CHORUS_LIMITS.name),
		enabled: true,
		goals: emptyChorusGoals(),
		pinned: noPins()
	};
}
