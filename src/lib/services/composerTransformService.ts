/**
 * Composer Transform Service
 * Runs the user's composer draft through an LLM for on-demand rewrites: Spellcheck
 * (fix spelling/grammar/punctuation/flow while preserving voice) and Impersonate (expand
 * a short draft into a full in-character message from the user's persona's perspective).
 * Both ride their own engine connection and that connection's generation settings,
 * so the two can sit on different models. Split in two on purpose (a pure build-prompt
 * function, then a run function), so the exact messages a real run would send can be
 * inspected without making the call, which is what `TransformPanel` prices its
 * before-you-press estimate off.
 *
 * No UI, no store writes, no persistence here: the result only ever reaches the draft
 * through `TransformPanel`'s approve/reject.
 */

import type { LLMMessage } from '$lib/types/llm';
import type { Message, ImpersonatePerspective } from '$lib/types/chat';
import { llmService } from '$lib/services/llm/provider';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { resolveMacroValues, substitute } from '$lib/macros';
import { buildLiveMacroContext } from '$lib/utils/live-macro-context';

/** Fixed closing turn for Impersonate: state the ask and nothing else, so the history
 *  above it stays the only context the model reads the scene from. */
const IMPERSONATE_CLOSING_INSTRUCTION = 'Write the message now. Reply with only the message text.';

export interface ComposerTransformParams {
	kind: 'spellcheck' | 'impersonate';
	draft: string;
	chatMessages: Message[];
	/** Impersonate only; defaults to 'first' when omitted. */
	perspective?: ImpersonatePerspective;
	signal?: AbortSignal;
}

/** Exported so the panel's cost estimate is counted off the exact messages a real run
 *  would send, and the two can never drift. */
export function buildComposerTransformPrompt(params: ComposerTransformParams): LLMMessage[] {
	const { kind, draft, chatMessages, perspective = 'first' } = params;

	const template = featurePromptsStore.promptFor(kind);
	// Global engine macros first ({{char}}/{{user}}/etc. from live story state), the flow's
	// own draft/perspective values on top, the same two-phase idiom the opening scene uses
	// for {{idea}}. Neither key is registered in macros.ts; they're ad-hoc flow values.
	// Impersonate is a story generation of its own, so lore entries limited to it fire here
	// and nowhere else. Spellcheck reads the same context under the plain send's terms.
	const ctx = buildLiveMacroContext({
		chatMessages,
		lorebookTrigger: kind === 'impersonate' ? 'impersonate' : undefined
	});
	const filled = substitute(template, {
		...resolveMacroValues(template, ctx),
		draft,
		perspective
	});

	if (kind === 'spellcheck') {
		// The template embeds the draft and needs no story context: a single user turn
		// is the shape every provider accepts.
		return [{ role: 'user', content: filled }];
	}

	// Impersonate: chat history rides as native-role turns, the same structural shape the
	// story prompt uses. The draft, persona, and perspective all live inside the filled
	// system template.
	const history: LLMMessage[] = chatMessages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

	return [
		{ role: 'system', content: filled },
		...history,
		{ role: 'user', content: IMPERSONATE_CLOSING_INSTRUCTION }
	];
}

export async function runComposerTransform(opts: ComposerTransformParams): Promise<string> {
	const { kind, draft, signal } = opts;

	// Fail loud at the top, same style as generateOpeningScene's disabled-guard
	// (messages.svelte.ts): the composer UI hides the trigger when its engine is off, so
	// reaching here with the flag off means something called in anyway.
	if (kind === 'spellcheck' && !featurePromptsStore.spellcheckEnabled) {
		throw new Error('Spellcheck is turned off in Settings → Engines');
	}
	if (kind === 'impersonate' && !featurePromptsStore.impersonateEnabled) {
		throw new Error('Impersonate is turned off in Settings → Engines');
	}
	if (!draft.trim()) throw new Error('Cannot transform an empty draft');

	const messages = buildComposerTransformPrompt(opts);

	// Unlike a background sidecar, these transforms are user-triggered foreground actions
	// the caller is actively waiting on, so errors (including AbortError) PROPAGATE: no
	// catch-and-null here. The approve/reject dialog renders them.
	const result = await llmService.complete({ engine: kind }, { messages, source: kind, signal });

	const text = result.content.trim();
	if (!text) throw new Error('The transform returned an empty result');
	return text;
}
