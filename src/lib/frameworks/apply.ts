/**
 * The one place a chat's framework state becomes a lorebook decorator.
 *
 * Every surface that assembles a prompt goes through this, for the reason every surface
 * resolves lorebooks through `resolveLorebooks`: the token meter and the real send both
 * build a prompt, and if they built their decorators differently the meter would price text
 * the send does not inject. Fork this at a call site and that is exactly what happens,
 * silently, because both still produce a plausible-looking prompt.
 *
 * Pure, so prompt assembly can import it: everything it needs arrives as an argument.
 *
 * See architecture/frameworks.md.
 */
import { NO_DECORATION, type LorebookDecorator } from '$lib/lorebook/engine';
import { LOREBOOK_POSITION_AT_DEPTH, type Lorebook, type LorebookEntry } from '$lib/lorebook/types';

import type { ChatFrameworkState } from './chat-state';
import { resolveDay, todaySerial } from './day';
import { applyFrameworks } from './dispatch';
import { FRAMEWORKS } from './registry';

/**
 * Build the decorator for one chat.
 *
 * `undefined` means the caller has no chat to speak for (a library meter, the prompt
 * builder pricing a preset), and answers `NO_DECORATION` rather than a day-1 default: a
 * surface holding no story must not invent one.
 *
 * The records the dispatcher produces are dropped here. They are what a reader-facing panel
 * would show to answer "why did nothing happen", and carrying them out means a field on
 * `PromptAssembly` beside the lorebook trace. That is the panel's change to make, not this
 * one's.
 */
export function frameworkDecorator(
	state: ChatFrameworkState | undefined,
	messages: readonly string[],
	now: Date = new Date()
): LorebookDecorator {
	if (!state) return NO_DECORATION;
	// Built once per assembly rather than per entry: the list, the day and the suppression
	// set are fixed for the whole prompt, and rebuilding them per entry would be the same
	// answer computed once per lorebook row.
	const ctx = {
		frameworks: FRAMEWORKS,
		// App-wide switches arrive with the settings page. Until there is somewhere to turn a
		// framework off, nothing is off, and an empty list says that honestly rather than
		// pretending the question has not been asked.
		disabled: [] as readonly string[],
		// The chat's mode decides which question is asked; nothing here mixes the two (day.ts).
		// Resolved once per assembly rather than per entry: the path, the mode and today are
		// fixed for the whole prompt, and re-scanning per lorebook row would be the same
		// answer computed once per row.
		//
		// `now` defaults here rather than being demanded of every caller, and this is the one
		// place a clock is read on the assembly path. The determinism contract the dispatcher
		// is held to is unaffected: it is handed a NUMBER, and the same number twice gives the
		// same prompt twice. What a clock costs is narrower and worth naming: a meter that ran
		// at 23:59 and a send at 00:01 price different days. That window is a real-time mode
		// asking to be told the real time, and it is the same window `{{date}}` in a lorebook
		// entry has always had.
		day: resolveDay({
			messages,
			mode: state.mode,
			manual: state.day,
			today: todaySerial(now)
		}).day,
		suppressed: state.suppressed,
		byFramework: state.byFramework
	};
	return (_entry, text) => applyFrameworks(text, ctx).text;
}

/**
 * The id of the book framework injections ride in, fixed rather than generated.
 *
 * `createEmptyLorebook` hands out a UUID, which would be a fresh one per assembly: the trace
 * the meter shows and the trace the send stores would name different books for the same text,
 * and nothing downstream could match one run against another.
 */
export const FRAMEWORK_BOOK_ID = 'frameworks';

/**
 * How far back an injected block lands. Zero: right against the generation point.
 *
 * An instruction about what to write in THIS reply is worth nothing four turns up the
 * transcript, which is where `DEFAULT_LOREBOOK_DEPTH` would put it. This is not yet a
 * setting because there is nowhere to set it; when the frameworks settings page arrives it
 * is the obvious second knob after the marker shape.
 */
const FRAMEWORK_DEPTH = 0;

/**
 * Every framework's injected block, as a lorebook the caller adds to its own.
 *
 * **They ride the lorebook's pipeline rather than being spliced in separately**, and that is
 * the whole design of this. An injected block is text in a prompt, so it has to be placed
 * somewhere, priced against the budget that caps lore, and visible in the trace that explains
 * the prompt. `renderLorebookBlock` answers all three already; a second channel beside it
 * would answer them again, differently, and the second answer is the one that goes wrong -- a
 * block outside the lore budget is a block the meter does not count, and the meter and the
 * send stop agreeing with nothing on screen saying so.
 *
 * Constant entries: they are addressed to the model rather than triggered by the story, so
 * there is nothing for a key to match on.
 *
 * Empty when no framework has anything to say, which is the normal case in `manual` mode.
 * An empty book is not returned at all, so a chat that injects nothing carries no empty group
 * through the trace.
 */
export function frameworkBooks(
	state: ChatFrameworkState | undefined,
	messages: readonly string[],
	now: Date = new Date()
): Lorebook[] {
	if (!state) return [];
	const day = resolveDay({
		messages,
		mode: state.mode,
		manual: state.day,
		today: todaySerial(now)
	}).day;

	const entries: LorebookEntry[] = [];
	for (const framework of FRAMEWORKS) {
		if (!framework.inject) continue;
		const content = framework.inject({
			day,
			mode: state.mode,
			state: state.byFramework[framework.id],
			now
		});
		if (!content || !content.trim()) continue;
		entries.push({
			// Named for the framework, so the same block is the same entry across runs and a
			// trace row can be read back to who wrote it.
			id: `framework:${framework.id}`,
			comment: framework.name,
			key: [],
			keysecondary: [],
			selectiveLogic: 0,
			content,
			constant: true,
			disable: false,
			position: LOREBOOK_POSITION_AT_DEPTH,
			depth: FRAMEWORK_DEPTH,
			// Ahead of ordinary lore in the budget's greedy admission, which sorts on this. A
			// framework block that lost its place to a character description would take the
			// day with it: the model stops being told the time, stops writing the marker, and
			// the day quietly stops moving.
			order: 0,
			probability: 100,
			useProbability: true,
			caseSensitive: null,
			matchWholeWords: null,
			rest: {}
		});
	}
	if (entries.length === 0) return [];

	const at = now.getTime();
	return [
		{
			id: FRAMEWORK_BOOK_ID,
			name: 'Frameworks',
			scanDepth: null,
			recursiveScanning: null,
			maxRecursionSteps: null,
			caseSensitive: null,
			matchWholeWords: null,
			entries,
			extensions: {},
			createdAt: at,
			updatedAt: at
		}
	];
}
