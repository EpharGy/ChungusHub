/**
 * The only thing frameworks store: a small blob on the chat row.
 *
 * Almost nothing needs to live here, and that is the design rather than an accident. A
 * framework is a pure function of its marker plus the story day (see types.ts), so nothing
 * accumulates per turn and nothing is written per character. What is left is the handful of
 * facts that are true of ONE STORY and therefore cannot sit in a shared lorebook entry:
 *
 *   - the day the story is on, which the entry cannot know;
 *   - the subjects this story holds out, because an entry is carried by every chat that
 *     triggers it and "she is not being tracked in this one" is not a fact about her;
 *   - whatever each framework needs to remember about this story alone.
 *
 * It rides `ChatFeatureState`, so it inherits that column's behaviour for free: deleting a
 * chat deletes it, duplicating a chat copies it, and the `chats` sync scope already
 * broadcasts it. No table, no sync scope of its own, no migration. Same argument the chat
 * notepad makes for the column over a table.
 *
 * Bounded on purpose. `getAllChats` is `SELECT *`, so every chat's blob rides every
 * chat-list fetch on every device: these two collections are naturally small, but
 * "naturally" is not a bound, and a blob that arrived oversized must not be re-saved at its
 * own length.
 *
 * See architecture/frameworks.md.
 */
import { normalizeSubjectKey } from './marker';

/** Farthest a story day may sit from zero. A story numbering its days is not counting to a
 *  million, and a value past this arrived corrupt or hand-edited. */
export const MAX_STORY_DAY = 1_000_000;

/** Subjects one story may hold out. Far past a cast list; a backstop, not a ration. */
export const MAX_SUPPRESSED = 200;

/** Frameworks that may keep a slice here. The registry bounds this in practice; the cap is
 *  for a blob that arrived carrying slices for frameworks this build has never heard of. */
export const MAX_FRAMEWORK_SLICES = 32;

/**
 * One chat's framework state.
 *
 * There is deliberately no day SOURCE field yet. Manual is the only source implemented, so a
 * selector would be a control with one position; the two the design calls for (the real
 * clock, and a `Day N` read off the story) each add themselves here when they are built.
 */
export interface ChatFrameworkState {
	/** The story day every framework computes against. */
	day: number;
	/** Subject keys this story holds out, across every framework. Lowercased, like the keys
	 *  markers parse to, so the two can be compared directly. */
	suppressed: string[];
	/**
	 * Each framework's own slice, keyed by framework id.
	 *
	 * Opaque here on purpose: the base guarantees only that a value is a plain object or
	 * absent, and the framework that owns a slice normalizes the inside of it when it reads
	 * it. A framework wanting a field of its own puts it in here, never as a new field on
	 * this interface, or the base has started knowing what frameworks are for.
	 */
	byFramework: Record<string, unknown>;
}

export function defaultChatFrameworkState(): ChatFrameworkState {
	return { day: 1, suppressed: [], byFramework: {} };
}

function normalizeDay(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
	return Math.max(-MAX_STORY_DAY, Math.min(MAX_STORY_DAY, Math.trunc(raw)));
}

/** Folded through the marker parser's own key rule and deduped, so a key written two ways in
 *  a stored blob cannot suppress a subject twice or fail to suppress it at all. It MUST be
 *  the same folding: these keys are compared against what a marker parsed to, and a name with
 *  a space folded one way here and another way there simply never matches. */
function normalizeSuppressed(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	for (const value of raw) {
		if (typeof value !== 'string' || !value.trim()) continue;
		seen.add(normalizeSubjectKey(value));
		if (seen.size >= MAX_SUPPRESSED) break;
	}
	return [...seen];
}

function normalizeByFramework(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Record<string, unknown> = {};
	for (const [id, slice] of Object.entries(raw as Record<string, unknown>)) {
		// A slice that is not a plain object is not something any framework wrote, and
		// handing one on would make every framework defend against it separately.
		if (!slice || typeof slice !== 'object' || Array.isArray(slice)) continue;
		out[id.toLowerCase()] = slice;
		if (Object.keys(out).length >= MAX_FRAMEWORK_SLICES) break;
	}
	return out;
}

/** Parse and clamp a stored framework blob. Anything missing or corrupt degrades to the
 *  default rather than throwing, the same convention the rest of `ChatFeatureState` follows:
 *  a chat that predates this feature simply reads as day 1 with nothing suppressed. */
export function normalizeChatFrameworkState(raw: unknown): ChatFrameworkState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultChatFrameworkState();
	const stored = raw as Record<string, unknown>;
	return {
		day: normalizeDay(stored.day),
		suppressed: normalizeSuppressed(stored.suppressed),
		byFramework: normalizeByFramework(stored.byFramework)
	};
}

/**
 * Read a `/day` argument against the day a chat is on.
 *
 * `+N` and `-N` are relative, a bare number is absolute, and anything else is null so the
 * caller can say so rather than silently landing on a day nobody asked for. The result is
 * clamped exactly as a stored day is, so the command and the normalizer cannot disagree
 * about what a legal day is.
 *
 * A consequence worth knowing: `-5` steps BACK five days and is never "set to day -5". A
 * story numbering its days from below zero is vanishingly rare next to wanting to rewind
 * one, and the relative reading is what the leading sign means everywhere else.
 */
export function parseDayArg(arg: string, current: number): number | null {
	const text = arg.trim();
	if (!/^[+-]?\d+$/.test(text)) return null;
	const value = Number(text);
	const next = text[0] === '+' || text[0] === '-' ? current + value : value;
	return Math.max(-MAX_STORY_DAY, Math.min(MAX_STORY_DAY, next));
}
