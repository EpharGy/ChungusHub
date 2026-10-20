/**
 * Chorus engine runner.
 *
 * Plays one character on the chat's Chorus list against the newest reply and asks what they
 * want and what they would do. Split like the Sprites runner: a pure build-prompt function and
 * a run function around `complete({ engine: 'chorus' })`, so the exact messages a real run
 * would send can be inspected without making the call.
 *
 * **One context per run, shared by every character.** `chorusContext` resolves the lorebook
 * once, through `buildLiveMacroContext`, the same resolver the story prompt goes through, so
 * every agent reads the same triggered lore and a probabilistic entry gets one roll per run
 * rather than one per character. The scan's trace comes back on the context and is never
 * stored: sticky and cooldown windows are measured off the traces stored on TURNS
 * (`lorebookHistory`), so a Chorus scan moves none of them.
 *
 * No UI and no persistence here: the caller (stores/chorus.svelte.ts) owns when to ask and
 * what to do with the answers.
 */

import type { LLMMessage } from '$lib/types/llm';
import type { Message } from '$lib/types/chat';
import type { MacroContext } from '$lib/macros';
import { resolveMacroValues, substitute } from '$lib/macros';
import { llmService } from '$lib/services/llm/provider';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { buildLiveMacroContext } from '$lib/utils/live-macro-context';
import { parseChorusAnswer, type ChorusAnswer } from '$lib/chorus/answer';
import type { ChorusGoalKey, ChorusGoals } from '$lib/chorus/state';

/**
 * The context every agent in one run is filled against.
 *
 * `messages` is the active path up to and INCLUDING the reply being read, and must end on it:
 * the history macros read the newest entry as the latest thing said, and the lore scan has to
 * see that reply's own text, so a character who walks in during it wakes their own entry.
 * The `trigger` is left absent, which is a plain send: the character's name in the chat
 * matches the entry's keys exactly as it would for the story.
 */
export function chorusContext(messages: Message[]): MacroContext {
	return buildLiveMacroContext({ chatMessages: messages });
}

export interface ChorusAgentParams {
	ctx: MacroContext;
	name: string;
	goals: ChorusGoals;
	pinned: Record<ChorusGoalKey, boolean>;
	/** The other switched-on characters on the list, by name. */
	cast: string[];
	signal?: AbortSignal;
}

/** Exported so the exact messages a real run would send stay inspectable. */
export function buildChorusAgentPrompt(params: ChorusAgentParams): LLMMessage[] {
	const { ctx, name, goals, cast } = params;
	const template = featurePromptsStore.promptFor('chorusAgent');
	// Global engine macros first ({{char}}, {{user}}, {{lorebook}}, the history macros), then
	// this flow's own keys on top, the two-phase idiom Sprites uses for {{labels}}. None of
	// these is a macros.ts entry: they mean nothing outside this call.
	const filled = substitute(template, {
		...resolveMacroValues(template, ctx),
		member: name,
		immediateGoal: goals.immediate || '(none set)',
		shortTermGoal: goals.shortTerm || '(none set)',
		longTermGoal: goals.longTerm || '(none set)',
		castList: cast.length ? cast.join(', ') : '(no one else)'
	});
	return [{ role: 'user', content: filled }];
}

/** Ask one character, and read their answer. Throws on a failed call and on a reply that
 *  ignored the format, so the caller can record which member it was. */
export async function askChorusMember(params: ChorusAgentParams): Promise<ChorusAnswer> {
	if (!featurePromptsStore.chorusEnabled) {
		throw new Error('Chorus is turned off in Settings → Engines');
	}
	// The harder half of the registry's `requires`: without {{member}} every agent is the same
	// anonymous voice, which still returns plausible JSON and so would look like a working run.
	if (!featurePromptsStore.promptFor('chorusAgent').includes('{{member}}')) {
		throw new Error('The Chorus character prompt has no {{member}}, so no agent knows who it is');
	}

	const result = await llmService.complete(
		{ engine: 'chorus' },
		{ messages: buildChorusAgentPrompt(params), source: 'chorus', signal: params.signal }
	);

	const answer = parseChorusAnswer(result.content, params.goals, params.pinned);
	if (!answer) throw new Error('The answer had no "want" or "intends" in it');
	return answer;
}
