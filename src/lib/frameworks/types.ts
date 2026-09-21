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
import type { DayMode, DaySource } from './day';
import type { FrameworkBlockDef } from './blocks';


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
	 * What KIND of number {@link day} is: `clock` for a serial date, `manual` for a story day
	 * the author chose.
	 *
	 * It travels with the day because a day without its unit is ambiguous, and a framework
	 * reading an ABSOLUTE anchor out of its own fields cannot make sense of one without the
	 * other -- `day.ts` says so where `DaySource` is declared, and then nothing passed it on.
	 * A framework doing pure arithmetic on the day (a cycle is `day mod length`) may ignore it
	 * entirely; one comparing the day against a date an author wrote may not.
	 */
	source: DaySource;
	/**
	 * This framework's own slice of the chat's state (`byFramework[id]`), exactly as it
	 * was stored. Opaque to the base, which never reads inside it.
	 */
	state: unknown;
	/**
	 * What other frameworks' markers said about THIS subject, keyed by their framework id
	 * and carrying their fields verbatim.
	 *
	 * A modifier marker is one nothing computes: it renders nothing and exists to change what
	 * another marker renders. `@demo[Her Name]` computes its line, and a `@tint[Her Name,
	 * shade=warm]` written in the steering is read here and changes what that line says. Two
	 * markers, one line, the second modifying the first rather than replacing it.
	 *
	 * The base stays ignorant of what any of it means, exactly as it does for `fields`: it
	 * collects markers by subject and hands them over. Empty for a subject nobody modified,
	 * which is the overwhelming majority.
	 */
	modifiers: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** What a framework is handed to write its own blocks into the prompt. */
export interface FrameworkInjectInput {
	/** The story day, the same number every `compute` on this assembly sees. */
	day: number;
	/** How the chat decides its day. A framework asking the model for something may want
	 *  nothing at all under one mode: the date framework says nothing in `manual`. */
	mode: DayMode;
	/** This framework's own slice of the chat's state, exactly as stored. */
	state: unknown;
	/** This framework's app-wide settings, exactly as stored. Opaque to the base, which never
	 *  reads inside one: the framework that owns it normalizes it, the same rule as `state`. */
	settings: unknown;
	/**
	 * The wall clock, handed in rather than read, so this stays as pure as `compute` and a
	 * test can pin it. Present because an injected block is the one thing a framework
	 * writes that macro expansion never reaches: entry content is expanded and THEN
	 * decorated, so a framework emitting `{{date}}` would ship those braces to the model.
	 */
	now: Date;
	/**
	 * Every running framework's reminder line, already filled, in registry order.
	 *
	 * Empty for all but the framework that gathers them. A reminders section is the one place
	 * several frameworks write into at once, and nothing else in this contract can express
	 * that: a block cannot be injected where it stands and also end up inside somebody else's
	 * tags. Gathering them here means one entry with one placement, rather than a bracket, a
	 * scattering of lines and an ordering convention holding them together.
	 */
	reminders: readonly string[];
}

/**
 * One block a framework contributes, and where it goes.
 *
 * **A framework returns a LIST of these rather than one string**, and that is not generality
 * for its own sake. A single framework routinely wants two placements at once: its
 * instructions wherever the reader filed them, and a one-line reminder down at the generation
 * point where a long prompt cannot bury it. Those are different depths, roles and orders, and
 * a framework that could only say one thing would have to choose between them.
 *
 * It is also what lets a reminders framework exist without being a special case: it opens a
 * section at a low order and closes it at a much later one, and every other framework's
 * reminder line lands in between by ordering alone. Nothing has to know about anything else.
 *
 * The fields are the lorebook's own, because that is what these become (`apply.ts`): entries
 * in a synthetic book, placed, priced against the shared lore budget and traced exactly as any
 * other injected line.
 */
export interface FrameworkEntry {
	/**
	 * A stable name for this block, unique within the framework. It becomes part of the
	 * entry's id, so it is how a reader tells one of a framework's blocks from another in the
	 * prompt trace, and it must not be generated per assembly.
	 */
	slot: string;
	content: string;
	/**
	 * Wrap the content in an XML gate named for the framework, so the model can see where one
	 * system's rules start and stop.
	 *
	 * Per entry rather than per framework, and that distinction is load-bearing: an
	 * instructions block wants its own gate, while a one-line reminder is meant to sit INSIDE
	 * somebody else's section and must not bring a second pair of tags in with it.
	 */
	gate: boolean;
	/** True to splice into the chat at {@link depth}; false to join the lorebook block. */
	atDepth: boolean;
	/** Turns back from the newest, 0 being hard against the generation point. Ignored when
	 *  {@link atDepth} is false. */
	depth: number;
	role: 'system' | 'user' | 'assistant';
	/**
	 * Lower is injected first, and the budget admits greedily in this order.
	 *
	 * It is also the only coordination there is between frameworks: a section's opening
	 * bracket takes a low order and its closing bracket a high one, and anything meant to sit
	 * inside picks a number between them.
	 */
	order: number;
}

/**
 * One framework's identity and what it contributes.
 *
 * Pure data plus its functions, the shape `EngineDef` uses for the same reason: a settings
 * page can be rendered from the list alone, and no per-framework wiring lives anywhere
 * else. Unlike an engine, a framework has no prompt template and makes no model call.
 *
 * **A framework may answer markers, inject a block, or both**, and the two are separate
 * jobs rather than a required one and an optional extra. A tracker answers markers and
 * injects nothing: it decorates text an author already wrote. The date framework injects
 * and answers no marker: what it contributes is an instruction, addressed to the model,
 * that belongs to no character. A framework with neither is a row in a settings page and
 * nothing else, which is not an error but is almost certainly a mistake.
 */
/** One value a referenced marker's field accepts. */
export interface FrameworkReferenceValue {
	/** Typed verbatim into the marker. */
	value: string;
	/** What it is called in prose. */
	label: string;
	/** One line: what choosing it does. */
	detail: string;
}

/**
 * A marker reference a framework publishes for its detail view.
 *
 * It is documentation as DATA, which is what lets the settings page render it while knowing
 * no framework by name. Deriving the values from whatever table already defines them is the
 * point: a reference computed from the real list cannot drift from it, the same argument the
 * macro reference makes for rendering itself out of the macro registry.
 */
export interface FrameworkReference {
	/** What the box is called when it is closed. A few words, not a sentence. */
	title: string;
	/**
	 * The marker as it should be typed, with a PLACEHOLDER where the subject goes.
	 *
	 * Rendered monospaced and selectable so it can be dragged over and copied by hand. Never
	 * a real name: a placeholder reads better as a template, and it is the only spelling that
	 * is safe in a file anyone might later read.
	 */
	snippet: string;
	/** Under the snippet: where the marker goes, and anything it will not do. */
	hint: string;
	/** What one of its fields accepts. Omitted for a marker with nothing to choose between. */
	values?: readonly FrameworkReferenceValue[];
}

export interface FrameworkDef {
	/** Also the marker's name: `@<id>[...]`. Lowercase, hyphen-separated. */
	id: string;
	name: string;
	/** The framework's row icon, and the orb in its detail view. A closed union rather than a
	 *  free string, so a name that does not draw is a build error rather than a blank circle
	 *  nobody notices; the same trade `EngineDef` makes. */
	icon: 'clock' | 'sliders';
	/** One line for the framework's row: what it computes. */
	summary: string;
	/** The tooltip beside the name in the detail view: what it does and what it reads. */
	description: string;
	/**
	 * Frameworks this one cannot work without, by id.
	 *
	 * Turning this one on turns those on, and they cannot be turned off while it is on. The
	 * rule is enforced in the stored state as well as in the UI, so a blob that arrived
	 * claiming an impossible combination is corrected rather than trusted.
	 */
	requires?: readonly string[];
	/**
	 * Marker references for the detail view: the shape to type, and what its values mean.
	 *
	 * Declared here rather than written into the settings page for the reason blocks are:
	 * that page must know no framework by name, so anything framework-specific arrives as
	 * data or it cannot arrive at all. A framework may publish more than one, because the
	 * marker a reader needs is not always the one this framework claims.
	 *
	 * Absent for a framework with no marker to type, and the page then renders nothing
	 * rather than an empty box that reads as something failing to load.
	 */
	reference?: readonly FrameworkReference[];
	/**
	 * Marker ids this framework READS but never computes, such as a `@tint` that says how the
	 * line a `@demo` renders should read.
	 *
	 * A modifier marker renders nothing. Its whole effect is on what another marker renders,
	 * and it reaches `compute` through {@link FrameworkComputeInput.modifiers}. Declaring it
	 * here is what lets the dispatcher tell one apart from a misspelling: both are ids no
	 * framework claims, and without a declaration the first is reported as the second, which
	 * sends a reader hunting a typo that is not there.
	 *
	 * The base still learns nothing about what any of it means. It learns only that this id is
	 * spoken for, so a marker carrying it is collected, stripped and recorded as understood.
	 *
	 * An id may be declared by one framework only, and may not be a framework id itself. Two
	 * claims on the same word is an ambiguity nothing downstream could resolve, so a registry
	 * test pins both rules rather than leaving the dispatcher to pick a winner.
	 */
	modifierIds?: readonly string[];
	/**
	 * The editable blocks this framework contributes, declared rather than built.
	 *
	 * The base stores them, renders their editors and injects them, so a framework gains a
	 * tunable without a line changing anywhere else, and the settings page never learns whose
	 * settings it is drawing. See blocks.ts.
	 */
	blocks?: readonly FrameworkBlockDef[];
	/**
	 * Substitute this framework's own placeholders in a block's text.
	 *
	 * Needed because an injected block is the one text in a prompt that macro expansion never
	 * reaches: entry content is expanded and THEN decorated. Absent means the text is sent as
	 * written, which is right for a framework whose blocks are plain prose.
	 *
	 * Held to the same purity rule as everything else here: the clock arrives in the input.
	 */
	fill?(text: string, input: FrameworkInjectInput): string;
	/**
	 * Compute this marker's line, or null for "nothing to say right now".
	 *
	 * Absent when the framework claims no marker. A marker addressed to one that does is
	 * recorded as `noOutput`: the framework exists and simply had nothing to say, which is
	 * the truth and reads very differently from `unknownFramework`.
	 *
	 * MUST be pure and deterministic: the same input has to produce the same string every
	 * time, because prompt assembly runs at least twice (the token meter, then the send)
	 * and the two must agree exactly. Nothing here may read a clock, call a random number
	 * generator, or touch a store.
	 */
	compute?(input: FrameworkComputeInput): string | null;

	/**
	 * The blocks this framework contributes to the prompt. Empty for "nothing to add".
	 *
	 * Held to the same purity rule as `compute`, and for the same reason: the meter and the
	 * send both build it and the two must agree byte for byte. The clock arrives in the
	 * input rather than being read here.
	 *
	 * What comes back rides the lorebook's own pipeline, so each block is placed, priced
	 * against the shared lore budget and traced exactly as an entry is, rather than being
	 * spliced in somewhere nothing can account for it.
	 */
	inject?(input: FrameworkInjectInput): FrameworkEntry[];
}

/** Why a marker did or did not put text in the prompt. */
export type FrameworkStatus =
	/** Computed and spliced in. */
	| 'rendered'
	/** The marker could not be parsed; `reason` says how. */
	| 'malformed'
	/** No framework claims that id (misspelled, or its branch is not in this build). */
	| 'unknownFramework'
	/** A modifier marker: some framework declared this id in `modifierIds`, so it was read
	 *  and removed. It renders nothing by design; what it changes is another marker's line. */
	| 'modifier'
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
	/**
	 * The modifier markers that applied to this subject, by framework id, or absent when
	 * nothing modified her.
	 *
	 * Carried on the record rather than looked up again by whoever displays it, for the reason
	 * `text` is: a surface that re-derived this could re-derive it from a different scan, and
	 * then the panel explains a line the prompt did not send. It rides every record for the
	 * subject, not only the rendered one, because "she was on something and the marker was
	 * suppressed anyway" is exactly the case a reader comes to the panel to understand.
	 */
	modifiers?: Readonly<Record<string, Readonly<Record<string, string>>>>;
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
	/** What kind of number `day` is. Handed to every `compute` beside it. */
	source: DaySource;
	/** Subject keys this story holds out, across every framework. */
	suppressed: readonly string[];
	/** Per-framework opaque state, keyed by framework id. */
	byFramework: Readonly<Record<string, unknown>>;
	/**
	 * Modifier markers gathered for this assembly, by subject key and then by framework id.
	 *
	 * Collected BEFORE the lorebook is resolved, from the steering standing over this prompt,
	 * because steering is not decorated: a marker written there is never seen by the
	 * dispatcher at all, and would reach the model as literal configuration text.
	 *
	 * **This is not the only place a modifier can be written.** A modifier marker inside a
	 * lorebook entry is found by the dispatcher's own pre-pass and applies to the markers in
	 * that entry; what arrives here is layered on top of it, because a steering note is the
	 * narrower statement. See `dispatch.ts`.
	 *
	 * Optional, and absent means no steering modifies anything. Every surface that assembles
	 * must pass the same one or the token meter prices a line the send does not emit.
	 */
	modifiers?: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
}

/** The dispatcher's answer: the rewritten text, and why each marker in it fared as it did. */
export interface FrameworkApplication {
	text: string;
	records: FrameworkRecord[];
}
