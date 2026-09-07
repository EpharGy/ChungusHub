/**
 * Frameworks: named, deterministic computations over story state that render a line of
 * text into the prompt.
 *
 * A framework is NOT a group of lorebook entries and NOT a bundle of switches. Books
 * already do both. What no book can do is arithmetic, and that is the whole reason this
 * exists: an entry cannot compute, and a model cannot be trusted to, so the calculation
 * happens here and its result is spliced into the entry's text on the way to the model.
 *
 * Everything a framework knows about a character is written in the entry itself, as a
 * marker (see marker.ts). Nothing is stored per character and nothing accumulates per
 * turn: a framework is a pure function of its marker's fields plus the story day, so
 * branches, swipes and regenerations are correct because there is no state to be wrong.
 *
 * The base owns the day, the subject-suppression list and the marker grammar. A framework
 * owns its own fields, its own arithmetic and its own opaque slice of per-chat state.
 *
 * See architecture/frameworks.md.
 */

/** What a framework is handed to compute one marker's line. */
export interface FrameworkComputeInput {
	/** The marker's subject key, folded by the parser. What identity is decided on: the
	 *  per-chat suppression list and every state map key on this. */
	key: string;
	/** The same subject as the author wrote it. What a framework PRINTS, because a line
	 *  read outside the entry it came from has nothing else to say who it is about. */
	subject: string;
	/**
	 * The marker's named fields, verbatim strings. The base does not know what any of
	 * them mean; parsing and validating them is the framework's own job, and a field it
	 * does not recognise is the framework's to ignore or reject.
	 */
	fields: Readonly<Record<string, string>>;
	/** The story day this chat is on. Owned by the base, shared by every framework. */
	day: number;
	/**
	 * This framework's own slice of the chat's state (`byFramework[id]`), exactly as it
	 * was stored. Opaque to the base, which never reads inside it.
	 */
	state: unknown;
}

/**
 * One framework's identity and its computation.
 *
 * Pure data plus one function, the shape `EngineDef` uses for the same reason: a settings
 * page can be rendered from the list alone, and no per-framework wiring lives anywhere
 * else. Unlike an engine, a framework has no prompt template and makes no model call.
 */
export interface FrameworkDef {
	/** Also the marker's name: `@<id>[...]`. Lowercase, hyphen-separated. */
	id: string;
	name: string;
	/** One line for the framework's row: what it computes. */
	summary: string;
	/** The tooltip beside the name in the detail view: what it does and what it reads. */
	description: string;
	/**
	 * Compute this marker's line, or null for "nothing to say right now".
	 *
	 * MUST be pure and deterministic: the same input has to produce the same string every
	 * time, because prompt assembly runs at least twice (the token meter, then the send)
	 * and the two must agree exactly. Nothing here may read a clock, call a random number
	 * generator, or touch a store.
	 */
	compute(input: FrameworkComputeInput): string | null;
}

/** Why a marker did or did not put text in the prompt. */
export type FrameworkStatus =
	/** Computed and spliced in. */
	| 'rendered'
	/** The marker could not be parsed; `reason` says how. */
	| 'malformed'
	/** No framework claims that id (misspelled, or its branch is not in this build). */
	| 'unknownFramework'
	/** The framework's app-wide switch is off. */
	| 'disabled'
	/** This story holds that subject out (`suppressed`). */
	| 'suppressed'
	/** The framework ran and had nothing to say. */
	| 'noOutput';

/**
 * One marker's outcome, kept whether or not it produced text.
 *
 * A feature whose whole effect can be an absence is invisible without this: the reader
 * asking "why did nothing happen" is asking about a marker that was stripped, and the
 * record is the only thing that can answer. Same doctrine as the lorebook's scan records.
 */
export interface FrameworkRecord {
	/** The marker exactly as written, so a rejected one can be shown as the author typed it. */
	raw: string;
	frameworkId: string;
	/** Null only when the marker was too malformed to yield one. */
	key: string | null;
	/** The author's own spelling of that key, for a surface that labels rows with it. Null
	 *  whenever `key` is. */
	subject: string | null;
	status: FrameworkStatus;
	/** The text that was spliced in. Present for `rendered` only. */
	text?: string;
	/** Why the marker was rejected. Present for `malformed` only. */
	reason?: string;
}

/** Everything the dispatcher needs, handed in rather than reached for, so it stays pure. */
export interface FrameworkContext {
	/**
	 * The frameworks to run, already filtered to those whose app-wide switch is ON. A
	 * framework the caller left out is reported as `unknownFramework`, so pass every
	 * registered one and use `disabled` for a switched-off framework instead: the two
	 * read very differently to someone debugging a marker that does nothing.
	 */
	frameworks: readonly FrameworkDef[];
	/** Ids of registered frameworks whose switch is off. Reported as `disabled`. */
	disabled: readonly string[];
	/** The story day. */
	day: number;
	/** Subject keys this story holds out, across every framework. */
	suppressed: readonly string[];
	/** Per-framework opaque state, keyed by framework id. */
	byFramework: Readonly<Record<string, unknown>>;
}

/** The dispatcher's answer: the rewritten text, and why each marker in it fared as it did. */
export interface FrameworkApplication {
	text: string;
	records: FrameworkRecord[];
}
