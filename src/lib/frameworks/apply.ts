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

import type { ChatFrameworkState } from './chat-state';
import { resolveDay } from './day';
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
	messages: readonly string[]
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
		// The story decides the day when it says one; the stored day is the floor. Resolved
		// once per assembly rather than per entry: the path is fixed for the whole prompt, and
		// re-scanning it per lorebook row would be the same answer computed once per row.
		day: resolveDay(messages, state.day).day,
		suppressed: state.suppressed,
		byFramework: state.byFramework
	};
	return (_entry, text) => applyFrameworks(text, ctx).text;
}
