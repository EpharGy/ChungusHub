/**
 * The one place a chat's framework state becomes a lorebook decorator and a set of injected
 * books.
 *
 * Every surface that assembles a prompt goes through this, for the reason every surface
 * resolves lorebooks through `resolveLorebooks`: the token meter and the real send both
 * build a prompt, and if they built their decorators differently the meter would price text
 * the send does not inject. Fork this at a call site and that is exactly what happens,
 * silently, because both still produce a plausible-looking prompt.
 *
 * Pure but for the clock, which defaults here rather than being demanded of every caller.
 *
 * See architecture/frameworks.md.
 */
import { NO_DECORATION, type LorebookDecorator } from '$lib/lorebook/engine';
import { LOREBOOK_POSITION_AT_DEPTH, type Lorebook, type LorebookEntry } from '$lib/lorebook/types';

import { enabledFrameworks, type ChatFrameworkState } from './chat-state';
import { resolveDay, todaySerial } from './day';
import { applyFrameworks } from './dispatch';
import { FRAMEWORKS } from './registry';
import { defaultFrameworkSettings, frameworkAvailable, type FrameworkSettings } from './settings';
import type { FrameworkEntry } from './types';

/**
 * The story day this chat is on, from its mode.
 *
 * One derivation, shared by the decorator and the injected books, so the number a framework
 * computes against and the number one writes about cannot disagree.
 */
function dayFor(state: ChatFrameworkState, now: Date): number {
	return resolveDay({ mode: state.mode, manual: state.day, today: todaySerial(now) }).day;
}

/**
 * The frameworks actually running: available on this install AND turned on by this story.
 *
 * Both switches, intersected in one place, because they answer different questions and a
 * surface that checked only one would be wrong in a way nothing on screen explains. The
 * requirement closure is applied first, so a framework held on by something that depends on it
 * still loses to the install switch: availability is the outer bound and nothing overrides it.
 */
export function runningFrameworks(state: ChatFrameworkState, settings: FrameworkSettings): string[] {
	return enabledFrameworks(state).filter((id) => frameworkAvailable(settings, id));
}

/**
 * Build the decorator for one chat.
 *
 * `undefined` means the caller has no chat to speak for (a library meter, the prompt
 * builder pricing a preset), and answers `NO_DECORATION` rather than a day-1 default: a
 * surface holding no story must not invent one.
 *
 * The records the dispatcher produces are dropped here. They are what a reader-facing panel
 * would show to answer "why did nothing happen", and the panel derives its own.
 */
export function frameworkDecorator(
	state: ChatFrameworkState | undefined,
	settings: FrameworkSettings = defaultFrameworkSettings(),
	now: Date = new Date()
): LorebookDecorator {
	if (!state) return NO_DECORATION;
	const on = runningFrameworks(state, settings);
	// Built once per assembly rather than per entry: the list, the day and the suppression
	// set are fixed for the whole prompt, and rebuilding them per entry would be the same
	// answer computed once per lorebook row.
	const ctx = {
		frameworks: FRAMEWORKS,
		// Frameworks are opted into per chat, so "off" is the default rather than an
		// exception. A marker for a framework this chat has not turned on reads as
		// `disabled`, which is the truth and points somewhere useful, where
		// `unknownFramework` would send someone hunting a misspelling that is not there.
		disabled: FRAMEWORKS.map((f) => f.id).filter((id) => !on.includes(id)),
		day: dayFor(state, now),
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

/** An entry's id: the framework and which of its blocks this is. Stable across runs, so a
 *  trace row can be read back to whoever wrote it. */
export function frameworkEntryId(frameworkId: string, slot: string): string {
	return `framework:${frameworkId}:${slot}`;
}

/**
 * The XML gate around a block that asked for one.
 *
 * Named for the framework, so the model can see where one system's rules start and stop, and
 * generated rather than typed into the template: a reader editing instructions should not have
 * to remember to close a tag, and a mismatched pair is worse than none.
 */
function gated(name: string, content: string): string {
	return `<${name}>\n${content}\n</${name}>`;
}

/**
 * Every enabled framework's injected blocks, as a lorebook the caller adds to its own.
 *
 * **They ride the lorebook's pipeline rather than being spliced in separately**, and that is
 * the whole design of this. An injected block is text in a prompt, so it has to be placed
 * somewhere, priced against the budget that caps lore, and visible in the trace that explains
 * the prompt. `renderLorebookBlock` answers all three already; a second channel beside it
 * would answer them again, differently, and the second answer is the one that goes wrong: a
 * block outside the lore budget is a block the meter does not count, and the meter and the
 * send stop agreeing with nothing on screen saying so.
 *
 * Entries are `constant`: they are addressed to the model rather than triggered by the story,
 * so there is nothing for a key to match on.
 *
 * Empty when nothing is on or nothing has anything to say, which is the default for a chat
 * that has never opted in. An empty book is not returned at all, so such a chat carries no
 * empty group through the trace.
 */
export function frameworkBooks(
	state: ChatFrameworkState | undefined,
	settings: FrameworkSettings = defaultFrameworkSettings(),
	now: Date = new Date()
): Lorebook[] {
	if (!state) return [];
	const on = runningFrameworks(state, settings);
	const day = dayFor(state, now);

	const entries: LorebookEntry[] = [];
	for (const framework of FRAMEWORKS) {
		if (!framework.inject || !on.includes(framework.id)) continue;
		const blocks = framework.inject({
			day,
			mode: state.mode,
			state: state.byFramework[framework.id],
			settings: settings.config[framework.id],
			now
		});
		for (const block of blocks) {
			if (!block.content.trim()) continue;
			entries.push(toEntry(framework.id, framework.name, block));
		}
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

function toEntry(frameworkId: string, name: string, block: FrameworkEntry): LorebookEntry {
	return {
		id: frameworkEntryId(frameworkId, block.slot),
		comment: `${name}: ${block.slot}`,
		key: [],
		keysecondary: [],
		selectiveLogic: 0,
		content: block.gate ? gated(name, block.content) : block.content,
		constant: true,
		disable: false,
		position: block.atDepth ? LOREBOOK_POSITION_AT_DEPTH : undefined,
		depth: block.depth,
		role: ROLE_IDS[block.role],
		order: block.order,
		probability: 100,
		useProbability: true,
		caseSensitive: null,
		matchWholeWords: null,
		rest: {}
	};
}

/** The lorebook's own role numbering, which `lorebookRoleOf` reads back. Named here so a
 *  framework can say `'system'` and never learn that roles are integers on the wire. */
const ROLE_IDS: Record<FrameworkEntry['role'], number> = { system: 0, user: 1, assistant: 2 };
