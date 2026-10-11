/**
 * The one macro module: registry and engine in a single file, so a macro is declared,
 * documented and substituted in exactly one place.
 *  - MACROS is the one list of what every macro means and where it resolves.
 *  - `substitute()` is the one string-substitution primitive every surface shares.
 *  - `expandMacros()` is the context-aware preset engine; it resolves its macro NAMES from
 *    MACROS too (see SYSTEM_MACROS) and defers the actual substitution to `substitute()`.
 *
 * Macros are GLOBAL: every macro-resolving surface (presets, the opening scene, the
 * composer transforms, memory templates) resolves the shared engine macros from the same
 * MacroContext, and each flow layers its own values on top (draft text, memory batches, …).
 * A macro whose data doesn't exist where it's used stays literal, visible in the prompt and
 * never silently gated. Flow values always win on a name collision.
 */

import type {
	CharacterTraits,
	PermanentTraitDef,
	TraitKey
} from '$lib/types/library';
import { PERMANENT_TRAITS } from '$lib/types/library';
import type { Message } from '$lib/types/chat';
import type { PromptControl } from '$lib/types/database';
import type { LorebookPlacedGroup, LorebookTrace } from '$lib/lorebook/types';
import { formatControlForPrompt } from '$lib/utils/prompt-controls';

// ============================================================================
// Registry: definitions + the shared substitution primitive
// ============================================================================

/** Display buckets for the macro reference, in the order the reference panel shows them. */
export type MacroGroup =
	| 'names'
	| 'context'
	| 'time'
	| 'random'
	| 'character-field'
	| 'memory';

/** Ordered group metadata for the macro reference UIs. */
export const MACRO_GROUPS: readonly { id: MacroGroup; label: string; hint: string }[] = [
	{ id: 'names', label: 'Names', hint: 'inline name references' },
	{ id: 'context', label: 'Story & context', hint: 'profiles, world info, history, memory' },
	{ id: 'time', label: 'Date & time', hint: "the reader's own clock, read as the prompt is built" },
	{ id: 'random', label: 'Randomness', hint: 'rolled fresh on every resolution, so the token meter and the send can differ' },
	{ id: 'character-field', label: 'Character fields', hint: 'one card field at a time' },
	{ id: 'memory', label: 'Memory pipeline', hint: 'filled while the memory engine runs, literal anywhere else' }
];

export interface MacroDef {
	/** The macro name without braces, e.g. 'lastCharMessage'. */
	name: string;
	/** One-line description shown in the macro-reference UIs. */
	description: string;
	/**
	 * Structural macros inject native-role messages instead of inline text (the preset
	 * engine handles them specially). They can't be filled by a plain string substitution.
	 */
	structural?: boolean;
	/** Display bucket for the macro reference. */
	group: MacroGroup;
	/**
	 * Engine macros resolve from the shared MacroContext (story + chat state) on EVERY
	 * surface. The rest are flow macros: their value only exists while a specific flow
	 * runs (a memory pass) and is supplied by that flow.
	 */
	engine?: boolean;
	/**
	 * The registered name is a SHAPE, not a resolvable name: the author writes the numbered
	 * form ({{chatHistoryLast20}}) or the argument form ({{roll::1d20}}) and a parser turns
	 * it into a value. Kept out of SYSTEM_MACROS so the lint warns on the placeholder, which
	 * resolves to nothing, rather than on the spelling that works.
	 */
	parameterized?: boolean;
	/**
	 * A spelling that actually resolves, for the macro reference to show and copy. Only
	 * meaningful on a `parameterized` entry, where the bare registered name is a shape that
	 * resolves to nothing: copying `{{roll}}` would hand the author something inert. The
	 * reference falls back to `{{name}}` when this is absent.
	 */
	sample?: string;
}

/**
 * Every macro the app knows about. The one place to add/rename/document a macro.
 *
 * Names follow SillyTavern's wherever ST has a macro for the same thing, so a preset author
 * coming from ST writes what their fingers already know. The ones ST has no equivalent for
 * ({{character}}, {{lorebook}}, {{chatHistory}}, {{memory}}, the memory-flow set) keep the
 * same camelCase shape so the registry reads as one system rather than two conventions.
 */
export const MACROS: readonly MacroDef[] = [
	// ----- Engine-owned (resolved from real story + chat state, everywhere) -----
	{ name: 'user', description: 'Persona / protagonist name.', engine: true, group: 'names' },
	{ name: 'char', description: 'Character name (resolved per-character inside their own fields).', engine: true, group: 'names' },
	{ name: 'persona', description: "The active persona's description.", engine: true, group: 'context' },
	{ name: 'character', description: "The active character's full profile (the whole-sheet blob).", engine: true, group: 'context' },
	{ name: 'lorebook', description: 'Lorebook entries, keyword-matched against recent messages.', engine: true, group: 'context' },
	{ name: 'memory', description: 'Chat-memory recall block (episode summaries).', engine: true, group: 'context' },
	{ name: 'chatHistory', description: 'Every turn, as native-role messages. Prompt items only: anywhere else it resolves to nothing.', engine: true, structural: true, group: 'context' },
	{ name: 'chatHistoryLastN', description: 'Only the newest N turns, as a plain transcript. Write the number: {{chatHistoryLast20}}.', engine: true, parameterized: true, sample: '{{chatHistoryLast20}}', group: 'context' },
	{ name: 'lastMessage', description: 'The newest turn, as inline text. A copy: the turn itself still rides {{chatHistory}}.', engine: true, group: 'context' },
	{ name: 'lastUserMessage', description: 'The newest user turn, as inline text.', engine: true, group: 'context' },
	{ name: 'lastCharMessage', description: 'The newest character turn, as inline text.', engine: true, group: 'context' },

	{ name: 'time', description: 'Current local time, e.g. 6:02 PM.', engine: true, group: 'time' },
	{ name: 'date', description: 'Current local date, e.g. August 22, 2026.', engine: true, group: 'time' },
	{ name: 'weekday', description: 'Current day of the week, e.g. Saturday.', engine: true, group: 'time' },
	{ name: 'isotime', description: 'Current local time as 24-hour HH:MM.', engine: true, group: 'time' },
	{ name: 'isodate', description: 'Current local date as YYYY-MM-DD.', engine: true, group: 'time' },

	// ----- Randomness (SillyTavern's {{random}} and {{roll}}, argument macros) -----
	// Both are `parameterized`: the bare name is a shape and resolves to nothing, so the
	// Prompt Builder's lint flags `{{random}}` written on its own, which is what an author
	// who forgot the list has actually written.
	{
		name: 'random',
		description: 'Picks one of the listed options at random. Separate with :: (or commas). Re-rolled on every resolution.',
		engine: true,
		parameterized: true,
		sample: '{{random::red::green::blue}}',
		group: 'random'
	},
	{
		name: 'roll',
		description: 'Rolls dice, NdM with an optional +/- modifier: {{roll::1d20}}, {{roll::3d6+4}}. A bare number means one die of that many sides. Re-rolled on every resolution.',
		engine: true,
		parameterized: true,
		sample: '{{roll::1d20}}',
		group: 'random'
	},

	// ----- Per-field character macros (place one card field individually) -----
	{ name: 'description', description: "The character's description field, on its own.", engine: true, group: 'character-field' },
	{ name: 'personality', description: "The character's personality-summary field, on its own.", engine: true, group: 'character-field' },
	{ name: 'charFirstMessage', description: "The character's opening message field, on its own.", engine: true, group: 'character-field' },
	{ name: 'mesExamples', description: "The character's example dialogue, block-formatted: <START> markers become the preset's example separator.", engine: true, group: 'character-field' },
	{ name: 'mesExamplesRaw', description: "The character's example dialogue exactly as the card wrote it, unformatted.", engine: true, group: 'character-field' },
	{ name: 'charPrompt', description: "The character card's own system-prompt override.", engine: true, group: 'character-field' },
	{ name: 'charInstruction', description: "The card's post-history instructions (jailbreak).", engine: true, group: 'character-field' },
	{ name: 'charVersion', description: "The character card's version tag.", engine: true, group: 'character-field' },
	{ name: 'charCreatorNotes', description: "The card's creator notes.", engine: true, group: 'character-field' },
	// SillyTavern names the notes macro but has none for the credit beside it, so this one
	// stays in the same char* family rather than inventing a second shape for one field.
	{ name: 'charCreator', description: "Who made the card (its Created by field).", engine: true, group: 'character-field' },
	// Belongs to the character card, and only to it. The opening-scene engine carries
	// its own typed direction in the call-site key {{idea}} precisely so it never
	// shadows this one (see generateOpeningScene in stores/messages.svelte.ts).
	{ name: 'scenario', description: "The character's scenario field.", engine: true, group: 'character-field' },

	// ----- Memory pipeline flow (extraction / promotion) -----
	{ name: 'deepMemory', description: 'Older, already-compacted arcs.', group: 'memory' },
	{ name: 'recentEpisodes', description: 'The newest raw episode summaries.', group: 'memory' },
	{ name: 'batch', description: "The new scene's messages to digest.", group: 'memory' },
	{ name: 'sceneLength', description: 'How long the episode should be, scaled to the batch.', group: 'memory' },
	{ name: 'mergeMode', description: 'Guidance on whether the merge continues a layer or starts fresh.', group: 'memory' },
	{ name: 'higherContext', description: 'Already-compacted context that must not be restated.', group: 'memory' },
	{ name: 'episodes', description: 'The episode summaries being merged.', group: 'memory' },
	{ name: 'recent', description: 'Recent episode summaries included in recall.', group: 'memory' }
] as const;

/** Names of the engine-owned macros that resolve exactly as written, derived so it can never
 *  drift from MACROS. Parameterized entries are excluded on purpose: only their numbered form
 *  resolves, so the bare placeholder is not a name anything provides. */
export const SYSTEM_MACROS: readonly string[] = MACROS.filter((m) => m.engine && !m.parameterized).map(
	(m) => m.name
);

/** Names of the structural macros, derived so it can never drift from MACROS. Every site
 *  that has to recognise them (the assembly tag scan, the nested-expansion fallback below)
 *  reads this list rather than spelling the names out again. */
export const STRUCTURAL_MACROS: readonly string[] = MACROS.filter((m) => m.structural).map(
	(m) => m.name
);

/** Matches {{name}} and {{name.sub}}, the one macro shape used everywhere. */
export const MACRO_REGEX = /\{\{(\w+(?:\.\w+)?)\}\}/g;

/**
 * The argument-taking macros, the ONE exception to the name-shaped form above:
 * {{random::a::b}} and {{roll::1d20}}, borrowed from SillyTavern so a preset written there
 * keeps working when it is imported here.
 *
 * The separator alternation is what buys that import compatibility. SillyTavern's own two
 * regexes disagree about it, and its default (non-experimental) engine matches `roll` with
 * `[ : ]` -- a class of exactly ONE character -- so `{{roll::1d20}}` captures `:1d20` there,
 * fails validation and silently disappears. Accepting `::`, `:` and whitespace for BOTH
 * macros takes every spelling either SillyTavern engine accepts, and fixes that one on the
 * way in rather than reproducing it.
 *
 * `[^{}]` rather than SillyTavern's `[^}]`: a nested `{{...}}` inside the argument is not
 * supported (it is not really supported there either), and excluding the brace keeps such a
 * write-up literal instead of half-matched.
 */
const ARG_MACRO_REGEX = /\{\{(random|roll)(?:::|:|\s)\s*([^{}]+?)\s*\}\}/gi;

/** Does this text carry an argument macro? The regex above is global and therefore carries a
 *  `lastIndex` between calls, so `.test` on it would answer differently on alternate calls;
 *  this non-global twin is derived from the same source and is safe to ask repeatedly. */
const ARG_MACRO_TEST = new RegExp(ARG_MACRO_REGEX.source, 'i');

/**
 * The one pattern `substitute` scans with: both shapes in a single alternation, derived from
 * the two sources above so they can never drift apart. Single-pass is the point -- running
 * the argument macros as a second `replace` would re-scan the values the first pass injected,
 * and a lorebook entry or a piece of story text containing the literal `{{random::a::b}}`
 * would then be rolled as if the author had written it.
 *
 * Capture groups, in order: 1 = argument macro name, 2 = its raw argument, 3 = a plain name.
 * The `i` flag is SillyTavern's (its macro regexes are all `/gi`) and only reaches the
 * argument names in practice: `\w+` already matched any case, and the lookup below is by the
 * captured text, so plain macros stay exactly as case-sensitive as they have always been.
 */
const SUBSTITUTION_REGEX = new RegExp(`${ARG_MACRO_REGEX.source}|${MACRO_REGEX.source}`, 'gi');

/** Heads each example-dialogue block when the preset names no `exampleSeparator` of its own
 *  (SillyTavern's <START> marker becomes this). An empty separator is a real choice, meaning
 *  no header line at all, so this is only ever the fallback for an ABSENT one. */
export const DEFAULT_EXAMPLE_SEPARATOR = '***';

/**
 * The one substitution primitive. Replaces every {{key}} from `values` in a single pass, so
 * a value containing {{...}} is never re-scanned, and through a function replacement so
 * literal $-sequences in a value aren't treated as replacement patterns.
 * Macros with no entry in `values` are left literal (so typos surface instead of vanishing).
 *
 * FORK DIVERGENCE. Upstream states in architecture/macros.md that this stays "a pure
 * name -> string map", because that is what lets a token meter and the send that follows it
 * resolve the same text and agree. The argument macros below break that on purpose, and the
 * cost is real and visible: a meter prices one roll and the send makes another. It is the
 * same trade the clock macros already took, and it is taken here for SillyTavern import
 * compatibility. See architecture/random-roll-macros.md for the whole argument.
 *
 * That decision is upstream's own and predates this (patcireamo, the initial commit), so
 * this is a divergence rather than a gap to be filled: it must not go up as a fait accompli.
 * Raise it as an issue and let the owner rule on the trade before opening a PR.
 *
 * Argument macros resolve HERE, at match time, rather than through `values`. That is not a
 * shortcut, it is the requirement: `values` is keyed by macro NAME and `extractMacroNames`
 * dedupes through a Set, so two `{{roll::1d20}}` in one template would share one key, one
 * lookup and therefore one number. Resolving inside the replace callback is what makes every
 * occurrence roll independently.
 */
export function substitute(template: string, values: Record<string, string>): string {
	if (!template) return '';
	return template.replace(
		SUBSTITUTION_REGEX,
		(
			match: string,
			argName: string | undefined,
			argBody: string | undefined,
			name: string | undefined
		) => {
			if (argName !== undefined) {
				// undefined means "not resolvable" (an empty list, a formula droll's grammar
				// rejects), and stays literal like every other unresolvable macro here.
				return resolveArgMacro(argName, argBody ?? '') ?? match;
			}
			return name !== undefined && name in values ? values[name] : match;
		}
	);
}

/**
 * Resolve one argument macro, or undefined to leave it literal.
 *
 * SillyTavern returns an empty string for a formula it cannot parse and logs to the console.
 * This returns undefined instead, so `{{roll::2d6+1d4}}` (valid-looking, but outside droll's
 * grammar) lands in the prompt where the author can see it. That is this file's own rule for
 * every other unresolvable macro, and it is the only behavioural difference from ST on input
 * ST itself considers malformed -- the syntax accepted is a strict superset of ST's.
 */
function resolveArgMacro(name: string, body: string): string | undefined {
	const arg = body.trim();
	if (!arg) return undefined;
	return name.toLowerCase() === 'random' ? pickRandom(arg) : rollDice(arg);
}

/**
 * Split a {{random}} argument into its options, by SillyTavern's rule: `::` wins outright
 * when present, otherwise commas, with `\,` escaping a literal one. The lookbehind is what
 * honours that escape; ST swaps in a placeholder string and swaps it back, which does the
 * same job with a sentinel that can collide.
 *
 * Items are trimmed on BOTH paths. ST's two engines disagree here -- its legacy regex path
 * trims the comma list but not the `::` one, while its newer registry engine trims both --
 * so this follows the newer one. It only ever differs for `{{random:: a :: b }}`, where the
 * spaces are plainly formatting rather than part of the option.
 */
function splitMacroList(body: string): string[] {
	if (body.includes('::')) return body.split('::').map((item) => item.trim());
	return body.split(/(?<!\\),/).map((item) => item.trim().replace(/\\,/g, ','));
}

/** One option from a {{random}} list. `splitMacroList` always yields at least one entry, and
 *  an empty option is a legitimate pick (ST allows it, e.g. `{{random::a::}}`). */
function pickRandom(body: string): string {
	const options = splitMacroList(body);
	return options[Math.floor(Math.random() * options.length)];
}

/** droll's entire grammar, restated: an optional count, `d`, the sides, an optional +/-
 *  modifier. No leading zeros, no multi-term formulas (`2d6+1d4`), no keep-highest (`4d6kh3`).
 *  Pinned to droll's own regex so an imported ST preset accepts and rejects identically. */
const DICE_FORMULA = /^([1-9]\d*)?d([1-9]\d*)([+-]\d+)?$/i;

/** Dice-count ceiling droll does not have. Its grammar allows `9999999999d6`, which is a
 *  browser hang from one typo; past this the macro stays literal instead. */
const MAX_DICE = 1000;

/**
 * Roll a droll formula, or undefined when it is not one. Carries ST's bare-number shorthand,
 * where `{{roll::6}}` means one six-sided die.
 */
function rollDice(formula: string): string | undefined {
	const parsed = DICE_FORMULA.exec(/^\d+$/.test(formula) ? `1d${formula}` : formula);
	if (!parsed) return undefined;
	const count = parsed[1] ? Number(parsed[1]) : 1;
	if (count > MAX_DICE) return undefined;
	const sides = Number(parsed[2]);
	// Math.random rather than ST's seedrandom: ST seeds a fresh generator per call with added
	// entropy, which is a roundabout way of asking for an unseeded roll. Nothing here is
	// reproducible by design, so there is no seed to carry.
	let total = parsed[3] ? Number(parsed[3]) : 0;
	for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
	return String(total);
}

/** Parses a {{chatHistoryLastN}} macro name into N, or undefined for any other name.
 *  The one place the parameterized shape is defined. */
export function cappedHistoryTurns(name: string): number | undefined {
	const match = name.match(/^chatHistoryLast(\d+)$/);
	return match ? Number(match[1]) : undefined;
}

/** Plain-text transcript, "Name: content" per turn: the inline-text form of chat history.
 *  `lastN` keeps only the newest N turns; omitted means ALL turns. Backs
 *  {{chatHistoryLastN}} so the format can't drift. */
function renderTranscript(messages: Message[], user: string, char: string, lastN?: number): string {
	const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const kept = lastN === undefined ? turns : lastN > 0 ? turns.slice(-lastN) : [];
	return kept
		.map((m) => `${m.role === 'user' ? user : char}: ${expandSelfRefs(m.content, char, user)}`)
		.join('\n\n');
}

/** The unique macro names referenced in a piece of text (without braces). */
export function extractMacroNames(text: string): string[] {
	if (!text) return [];
	const names = new Set<string>();
	for (const match of text.matchAll(MACRO_REGEX)) {
		names.add(match[1]);
	}
	return [...names];
}

// ============================================================================
// Tag-block pruning: conditional framing without syntax
// ============================================================================
//
// A preset item can wrap a macro in a plain XML tag block (`<memory>{{memory}}</memory>`).
// When every macro a block carries resolves to empty, the whole block goes: tags, framing
// text and all, instead of being sent as a dangling empty shell. The rules, applied
// bottom-up so pruning cascades outward:
//   1. A block whose content is nothing but whitespace after pruning its children and
//      substituting known values is dropped (this is how an outer wrapper follows its
//      emptied children out).
//   2. A block whose OWN text references macros, all of them known and empty, is dropped
//      with its static framing, since the label exists for the content and dies with it,
//      but never while a surviving child block still holds content.
//   3. Blocks with no macros anywhere are static text and are never touched. Unknown
//      macro names stay literal (per `substitute`), so a typo keeps its block alive and
//      visible instead of silently vanishing.
// Only plain `<name>` tags (no attributes, no self-closing) form blocks; anything else,
// including unmatched tags, is left alone. Pruning runs on the item TEMPLATE before
// substitution, so tags arriving inside macro values can never form prunable blocks.

/** Plain opening tag, the only shape that forms a prunable block. */
const TAG_OPEN_RE_SRC = '<([A-Za-z][A-Za-z0-9_-]*)>';

interface PruneLevel {
	/** This level's text with pruned child blocks removed (template form, unsubstituted). */
	out: string;
	/** True when this level or anything below references a macro or pruned a block. */
	dynamic: boolean;
	/** Macro names referenced in this level's own text, outside surviving child blocks. */
	directMacros: string[];
	/** Child blocks kept at this level. */
	survivingChildren: number;
	/** True when this level's own text, or a surviving child's, carries an argument macro
	 *  ({{random}}, {{roll}}). Those always produce text, so they veto pruning outright. */
	hasArgMacro: boolean;
}

/** Index right after the close tag matching an open `<name>` whose content starts at `from`,
 *  or -1 when unbalanced. Depth-counted so same-name nesting pairs correctly. */
function findMatchingClose(text: string, name: string, from: number): number {
	const token = new RegExp(`</?${name}>`, 'g');
	token.lastIndex = from;
	let depth = 1;
	let m: RegExpExecArray | null;
	while ((m = token.exec(text)) !== null) {
		depth += m[0][1] === '/' ? -1 : 1;
		if (depth === 0) return m.index;
	}
	return -1;
}

function shouldPrune(block: PruneLevel, values: Record<string, string>): boolean {
	if (!block.dynamic) return false;
	// An argument macro always produces text -- a roll, a chosen option, or its own literal
	// self when the argument is malformed -- so a block carrying one is neither empty nor pure
	// framing, whatever its other macros resolved to. Checked BEFORE the substitute below,
	// which would otherwise roll dice purely to measure emptiness and discard the result.
	if (block.hasArgMacro) return false;
	// Emptied out entirely. Unknown macros stay literal in `substitute`, so a typo'd name
	// keeps the block non-empty and visible rather than silently pruned.
	if (!substitute(block.out, values).trim()) return true;
	// Framing case: the block's own macros all came back empty, so its static text is
	// framing for content that isn't there and goes with it. A surviving child always vetoes.
	if (block.survivingChildren > 0 || block.directMacros.length === 0) return false;
	return block.directMacros.every((name) => name in values && !values[name].trim());
}

/** One nesting level: recurse into child blocks, drop the ones that prune, and report
 *  what this level saw so the caller can judge the enclosing block. */
function pruneLevel(text: string, values: Record<string, string>): PruneLevel {
	// Local regex instance: recursion would corrupt a shared one's lastIndex.
	const openRe = new RegExp(TAG_OPEN_RE_SRC, 'g');
	let out = '';
	let ownText = '';
	let dynamic = false;
	let survivingChildren = 0;
	let hasArgMacro = false;
	let pos = 0;

	let match: RegExpExecArray | null;
	while ((match = openRe.exec(text)) !== null) {
		const name = match[1];
		const innerStart = match.index + match[0].length;
		const closeAt = findMatchingClose(text, name, innerStart);
		if (closeAt === -1) continue; // unmatched tag: plain text, keep scanning after it

		const before = text.slice(pos, match.index);
		out += before;
		ownText += before;

		const child = pruneLevel(text.slice(innerStart, closeAt), values);
		if (shouldPrune(child, values)) {
			dynamic = true; // a pruned child alone can empty this block out
		} else {
			out += `<${name}>${child.out}</${name}>`;
			dynamic = dynamic || child.dynamic;
			hasArgMacro = hasArgMacro || child.hasArgMacro;
			survivingChildren++;
		}
		pos = closeAt + name.length + 3; // past `</name>`
		openRe.lastIndex = pos;
	}
	const rest = text.slice(pos);
	out += rest;
	ownText += rest;

	const directMacros = extractMacroNames(ownText);
	return {
		out,
		dynamic: dynamic || directMacros.length > 0,
		directMacros,
		survivingChildren,
		hasArgMacro: hasArgMacro || ARG_MACRO_TEST.test(ownText)
	};
}

/**
 * Remove tag blocks whose macros all resolved empty (see the rules above). Returns the
 * template ready for `substitute`: untouched when nothing prunes, whitespace-tidied
 * (gaps collapsed, ends trimmed) when something did.
 */
export function pruneEmptyTagBlocks(text: string, values: Record<string, string>): string {
	if (!text || !text.includes('<')) return text;
	const { out } = pruneLevel(text, values);
	if (out === text) return text;
	return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================================
// Engine: context-aware preset expansion
// ============================================================================

export interface MacroContext {
	resolvedPersona?: PromptCharacter | null;
	resolvedCharacters?: PromptCharacter[];
	/** The lorebook block injected at {{lorebook}}, already scanned and rendered by the context
	 *  builder (`resolveLorebooks`, lorebook/engine.ts). Empty when nothing fired. */
	lorebook?: string;
	/** Why that block holds what it holds. A resolution OUTPUT carried here so assembly can hand
	 *  it to the caller that stores it on the turn; no macro reads it. */
	lorebookTrace?: LorebookTrace;
	/** The lore that asked to sit at a depth inside the chat rather than in the block. Another
	 *  resolution OUTPUT, spliced by assembly the way steering is; no macro reads it either. */
	lorebookPlaced?: LorebookPlacedGroup[];
	chatMessages?: Message[]; // Full chat path for the history and last-turn macros
	/** Pre-rendered chat-memory recall block, injected via {{memory}} (empty when off). */
	memory?: string;
	/** Ids of messages folded into memory, excluded from {{chatHistory}} so they're not duplicated. */
	archivedMessageIds?: Set<string>;
	/** Ids of the oldest turns dropped by the context-size budget, excluded from {{chatHistory}}. */
	droppedMessageIds?: Set<string>;
	/** Whether the enabled preset injects {{chatHistory}}: the budget trim can only drop
	 *  turns that something actually renders. Absent = it doesn't, the empty-preset
	 *  fallback's answer. */
	injectsHistory?: boolean;
	/** Active preset's custom controls, binding macro names to user-facing widgets. */
	controls?: PromptControl[];
	/** Global values for the custom controls, keyed by control macro name. */
	customFields?: Record<string, unknown>;
	/** The active preset's opt-in for tag-block pruning (PromptPreset.pruneEmptyBlocks). */
	pruneEmptyBlocks?: boolean;
	/** Per-preset separator that replaces <START> in example dialogue; absent =
	 *  {@link DEFAULT_EXAMPLE_SEPARATOR}. */
	exampleSeparator?: string;
	/** Budget-trim signal: drop this many oldest example-dialogue blocks. */
	droppedExampleBlocks?: number;
}

/**
 * The clock macros, replicating SillyTavern's so a preset written there reads the same here.
 * ST formats each through moment and reads the clock AT SUBSTITUTION TIME, which is what
 * these do:
 *
 *   {{time}}     moment().format('LT')           6:02 PM
 *   {{date}}     moment().format('LL')           August 22, 2026
 *   {{weekday}}  moment().format('dddd')         Saturday
 *   {{isotime}}  moment().format('HH:mm')        18:02
 *   {{isodate}}  moment().format('YYYY-MM-DD')   2026-08-22
 *
 * The locale is pinned to en-US rather than following the browser's, which is the one place
 * this deliberately does NOT do the locally-correct thing. ST never calls `moment.locale`, so
 * it runs on moment's default `en` and a preset saying "the current real time is {{time}},
 * {{weekday}} {{date}}" was written against that shape. A reader on en-GB would otherwise
 * silently get "6:02 pm, Saturday 22 August 2026", changing what the model reads because of
 * where the reader lives.
 *
 * The TIME ZONE is the reader's own: `Date`'s accessors are local, so this is the clock on
 * their wall written in a fixed format, not a fixed clock.
 */
function formatClock(): string {
	return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatLongDate(): string {
	return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatWeekday(): string {
	return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

function formatIsoTime(): string {
	const d = new Date();
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatIsoDate(): string {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PromptCharacter {
	name: string;
	traits: CharacterTraits;
	storyNotes?: string;
}

/**
 * Macros this module resolves itself instead of through the plain field map. `mesExamples`
 * lives in PERMANENT_TRAITS like any other field, but its value is block-formatted first
 * (SillyTavern `<START>` handling in `formatExampleDialogue`), so a plain map entry would
 * hand back the raw text and double-resolve it. `{{mesExamplesRaw}}` is the unformatted form
 * of the same field, resolved below: no trait of its own, so it never enters the map.
 */
const SPECIAL_FIELD_MACROS: readonly string[] = ['mesExamples'];

/**
 * Per-field character macros → the trait they resolve. A preset can place any card field on
 * its own with these (SillyTavern-style), independent of the whole-sheet {{character}} blob.
 * They resolve against the chat's bound character; {{persona}} covers the protagonist.
 *
 * Derived from PERMANENT_TRAITS: the trait definitions already pair each field with its
 * macro, so a field that gains, loses, or renames a macro reaches resolution with no second
 * edit here.
 */
const CHARACTER_FIELD_MACROS: Record<string, TraitKey> = Object.fromEntries(
	PERMANENT_TRAITS.character
		.filter((t): t is PermanentTraitDef & { macro: string } => !!t.macro)
		.filter((t) => !SPECIAL_FIELD_MACROS.includes(t.macro))
		.map((t) => [t.macro, t.key])
);

/**
 * Resolve the engine values for every macro a text references: the global half of any
 * substitution. Flow surfaces merge their own values OVER this record (flow wins on a
 * collision), then call `substitute` once, so injected values are never re-scanned.
 * Unknown macros get no entry and stay literal, so typos surface instead of vanishing.
 */
export function resolveMacroValues(text: string, context: MacroContext): Record<string, string> {
	const values: Record<string, string> = {};
	if (!text) return values;
	for (const name of extractMacroNames(text)) {
		const value = resolveMacro(name, context);
		if (value !== undefined) values[name] = value;
	}
	return values;
}

/**
 * Expand all macros in the given text using the provided context. Resolves each referenced
 * name to its value, then defers to the shared `substitute` primitive.
 */
export function expandMacros(text: string, context: MacroContext): string {
	if (!text) return '';
	return substitute(text, resolveMacroValues(text, context));
}

/**
 * Resolve a single macro name to its value, or undefined when nothing here answers it.
 *
 * Engine macros resolve FIRST and always win, so a preset control reusing an engine name (a
 * stray {{user}} control, say) is ignored rather than allowed to shadow the engine value.
 * The Prompt Builder flags such a control in the UI as well.
 */
function resolveMacro(name: string, context: MacroContext): string | undefined {
	const { resolvedPersona, resolvedCharacters } = context;

	// Structural macros belong to prompt-assembly, which preserves their native roles. Empty
	// here is the fallback for one reached through nested expansion.
	if (STRUCTURAL_MACROS.includes(name)) {
		return '';
	}

	// {{chatHistoryLastN}} is the EXPLICIT way to get a shortened history, as inline
	// transcript text. Nothing ever caps {{chatHistory}} behind the author's back.
	const lastN = cappedHistoryTurns(name);
	if (lastN !== undefined) {
		return renderTranscript(
			context.chatMessages ?? [],
			resolvedPersona?.name || 'User',
			resolvedCharacters?.[0]?.name || 'Narrator',
			lastN
		);
	}

	// Data system macros. With nothing resolved they resolve empty (still not shadowable).
	switch (name) {
		case 'user':
			return resolvedPersona?.name || '';
		case 'char':
			// The character the chat is bound to.
			return resolvedCharacters?.[0]?.name || '';
		case 'lastMessage':
			return lastTurnText(context);
		case 'lastUserMessage':
			return lastTurnText(context, 'user');
		case 'lastCharMessage':
			return lastTurnText(context, 'assistant');
		case 'persona':
			return formatPersona(resolvedPersona ?? null);
		case 'character':
			return formatCharacters(
				resolvedCharacters ?? [],
				resolvedPersona?.name || 'User',
				context.exampleSeparator ?? DEFAULT_EXAMPLE_SEPARATOR
			);
		case 'lorebook':
			// Scanned and rendered ONCE, when the context was built, so every re-resolve inside
			// one assembly prints the same block and the trace stored on the turn names exactly
			// the entries that shaped it. Rolling Trigger % here instead would give the budget
			// trim's re-resolves a fresh set of entries each pass.
			return context.lorebook ?? '';
		case 'memory':
			// Chat-memory recall, pre-rendered by the prompt builder. Empty when memory is
			// off, so the macro simply vanishes from the prompt.
			return context.memory ?? '';
		// The reader's own clock, read here at substitution time exactly as SillyTavern reads
		// it: these resolve in the browser, and a model told the time should be told the time
		// where the person typing is, not where the server happens to be racked. Their locale
		// is deliberately NOT followed - the formatters above say why.
		case 'time':
			return formatClock();
		case 'date':
			return formatLongDate();
		case 'weekday':
			return formatWeekday();
		case 'isotime':
			return formatIsoTime();
		case 'isodate':
			return formatIsoDate();
	}

	// {{mesExamples}} is block-formatted separately from the other per-field macros: <START>
	// markers split the raw field into blocks, each re-headered with the preset's separator,
	// so the budget trim can drop the oldest blocks the same way it drops history turns.
	// {{mesExamplesRaw}} is the same field with none of that: what the card wrote, self-refs
	// expanded and nothing else. Deliberately outside the trim, because raw means raw.
	if (name === 'mesExamples' || name === 'mesExamplesRaw') {
		const char = resolvedCharacters?.[0];
		const raw = char?.traits.exampleDialogue;
		if (!char || !raw) return '';
		const personaName = resolvedPersona?.name || 'User';
		if (name === 'mesExamplesRaw') return expandSelfRefs(raw, char.name, personaName);
		return formatExampleDialogue(raw, {
			separator: context.exampleSeparator ?? DEFAULT_EXAMPLE_SEPARATOR,
			dropOldest: context.droppedExampleBlocks ?? 0,
			charName: char.name,
			personaName
		});
	}

	// Per-field character macros: the bound character's raw field value (self-refs expanded),
	// with no labels or framing, so the preset author supplies the wrapping. Engine-resolved,
	// so a stray control can't shadow them.
	const fieldKey = CHARACTER_FIELD_MACROS[name];
	if (fieldKey) {
		const char = resolvedCharacters?.[0];
		if (!char) return '';
		const raw = char.traits[fieldKey];
		if (!raw) return '';
		return expandSelfRefs(raw, char.name, resolvedPersona?.name || 'User');
	}

	// Everything else is a preset macro: pov, genre, content_rating and anything an author
	// wires up, resolved from the active preset's controls. The default preset seeds these,
	// so it doubles as the reference example. Unknown names stay literal so typos surface.
	const custom = resolveCustomControl(name, context);
	if (custom !== undefined) return custom;

	return undefined;
}

/**
 * The newest turn's text, optionally the newest of one role: the shared body of
 * {{lastMessage}} / {{lastUserMessage}} / {{lastCharMessage}}. Inline text, never a
 * native turn: none of the three removes anything from {{chatHistory}}, so a preset that
 * uses one is quoting a turn the history also carries. Self-refs resolve live, exactly as
 * they do in an injected turn or a transcript.
 */
function lastTurnText(context: MacroContext, role?: 'user' | 'assistant'): string {
	const msgs = context.chatMessages ?? [];
	for (let i = msgs.length - 1; i >= 0; i--) {
		if (role && msgs[i].role !== role) continue;
		return expandSelfRefs(
			msgs[i].content,
			context.resolvedCharacters?.[0]?.name || 'Narrator',
			context.resolvedPersona?.name || 'User'
		);
	}
	return '';
}

/**
 * Resolve a macro against the active preset's custom controls.
 * Returns undefined (macro stays literal) if no control binds to this name.
 */
function resolveCustomControl(name: string, context: MacroContext): string | undefined {
	const control = context.controls?.find((c) => c.macro === name);
	if (!control) return undefined;
	return formatControlForPrompt(control, context.customFields?.[name]);
}

/**
 * Expand the self-referential macros that live inside a character's own field values.
 * {{char}} becomes the character's name and {{user}} the persona's, done per-character
 * rather than in the global macro pass so imported cards keep their macros and a rename just
 * works. Case- and whitespace-tolerant to match the variants cards use.
 */
export function expandSelfRefs(text: string, charName: string, userName: string): string {
	if (!text) return text;
	return text
		.replace(/\{\{\s*char\s*\}\}/gi, charName)
		.replace(/\{\{\s*user\s*\}\}/gi, userName);
}

/** Split a raw example-dialogue field into individual blocks on <START> markers
 *  (SillyTavern's convention, case-insensitive). Trims each block and drops empties;
 *  a field with no markers is a single block. Empty/whitespace input yields []. */
export function splitExampleBlocks(raw: string): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(/<START>/gi)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
}

/**
 * Format a character's raw example-dialogue field into the form actually sent: split into
 * blocks on <START>, optionally drop the oldest `dropOldest` blocks (the context-budget
 * trim's signal), prefix each surviving block with the preset's separator as its own header
 * line (skipped when the separator is empty), join blocks with a blank line between them, and
 * finally expand {{char}}/{{user}} self-refs once over the whole result.
 */
function formatExampleDialogue(
	raw: string,
	opts: { separator: string; dropOldest?: number; charName: string; personaName: string }
): string {
	let blocks = splitExampleBlocks(raw);
	if (opts.dropOldest && opts.dropOldest > 0) blocks = blocks.slice(opts.dropOldest);
	if (blocks.length === 0) return '';
	const formatted = opts.separator ? blocks.map((block) => `${opts.separator}\n${block}`) : blocks;
	return expandSelfRefs(formatted.join('\n\n'), opts.charName, opts.personaName);
}

/**
 * Format a single character/persona into lines. The name leads as a plain field; the
 * enclosing preset tag (e.g. <Character> / <Protagonist>) supplies the framing, so no
 * markdown headers here.
 */
function formatSingleCharacter(
	name: string,
	traits: CharacterTraits,
	permanentTraits: PermanentTraitDef[],
	charName: string,
	userName: string,
	exampleSeparator: string,
	storyNotes?: string
): string[] {
	const lines: string[] = [`**Name:** ${name}`];

	// Only the descriptive sheet fields ride the blob; the opening message, instructions and
	// metadata are placed by their own macros, so they're never dumped here.
	for (const { key, label, inBlob } of permanentTraits) {
		if (!inBlob) continue;
		const raw = traits[key];
		if (!raw) continue;
		// The example-dialogue field is fixed text here (not trimmable), but still normalized:
		// <START> markers become the same separator-headed blocks the {{mesExamples}} macro emits.
		const value =
			key === 'exampleDialogue'
				? formatExampleDialogue(raw, { separator: exampleSeparator, charName, personaName: userName })
				: expandSelfRefs(raw, charName, userName);
		if (!value) continue;
		lines.push(`**${label}:** ${value}`);
	}

	if (storyNotes?.trim()) {
		lines.push(`**Story Notes:** ${expandSelfRefs(storyNotes.trim(), charName, userName)}`);
	}

	return lines;
}

/**
 * The active persona's description and nothing else, matching SillyTavern's {{persona}}. The
 * name is not part of it: {{user}} already places that, and a preset author who wants both
 * writes both. Personas are a single free-text field (PERMANENT_TRAITS.persona), so there is
 * no sheet to format here the way {{character}} has one.
 */
function formatPersona(activePersona: PromptCharacter | null): string {
	const description = activePersona?.traits.description;
	if (!description) return '';
	return expandSelfRefs(description, activePersona.name, activePersona.name);
}

/**
 * Format the active character into a single headerless sheet. A chat binds one character, so
 * this resolves to a single sheet; the array is walked defensively and would stack multiple
 * name-led sheets rather than lose any.
 */
function formatCharacters(characters: PromptCharacter[], userName: string, exampleSeparator: string): string {
	return characters
		.filter((char) => char.name)
		.map((char) =>
			formatSingleCharacter(
				char.name,
				char.traits,
				PERMANENT_TRAITS.character,
				char.name,
				userName,
				exampleSeparator,
				char.storyNotes
			).join('\n')
		)
		.join('\n\n');
}

/**
 * The turns `{{chatHistory}}` injects: the whole chat path minus `excludedIds`
 * (memory-archived + budget-trimmed). ONE function, because the injection and the budget
 * trim's history token count must never be able to disagree about which turns those are.
 *
 * `{{chatHistory}}` carries every turn, including the newest, and the three
 * `{{last*Message}}` macros are plain inline text that take nothing away from here. Handing
 * the newest turn to a second structural macro instead is what lets a turn fall between the
 * two and vanish, and what makes the trim price turns the other macro carried.
 * Messages are returned whole so an injection keeps its attachments.
 */
export function historyTurns(
	messages: Message[] | undefined,
	excludedIds: Set<string> | undefined
): Message[] {
	if (!messages || messages.length === 0) return [];
	return excludedIds?.size ? messages.filter((m) => !excludedIds.has(m.id)) : messages;
}
