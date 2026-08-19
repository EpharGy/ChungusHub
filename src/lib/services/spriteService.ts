/**
 * Sprites engine runner.
 *
 * Reads the newest assistant turn and answers with one of the character's own sprite labels,
 * which is the picture the chat then shows. Split in two like the composer transforms (a pure
 * build-prompt function, then a run function), so the exact messages a real run would send can
 * be inspected without making the call.
 *
 * How much of the story the model reads is the TEMPLATE's decision, not this module's: the
 * excerpt comes from the ordinary history macros ({{chatHistoryLast3}}, {{lastMessage}}, …)
 * resolving against the path handed in. An author who wants this cheap writes a smaller
 * number; nothing here caps it behind their back.
 *
 * No UI and no persistence here: the caller (stores/sprites.svelte.ts) owns when to ask and
 * what to do with the answer.
 */

import type { LLMMessage } from '$lib/types/llm';
import type { Message } from '$lib/types/chat';
import { llmService } from '$lib/services/llm/provider';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { resolveMacroValues, substitute } from '$lib/macros';
import { buildLiveMacroContext } from '$lib/utils/live-macro-context';
import { pickLabel } from '$lib/utils/sprites';

export interface SpriteReadParams {
	/** The character's sprite labels: the only legal answers. */
	labels: string[];
	/**
	 * The active path up to and INCLUDING the turn being read, oldest first. It must end on
	 * that turn: every history macro reads the newest entry as the latest thing said, and the
	 * template asks about the end of it, so a trailing user turn would aim the question at the
	 * wrong line.
	 */
	messages: Message[];
	signal?: AbortSignal;
}

/** Exported so the exact messages a real run would send stay inspectable, and so the prompt
 *  can never drift from what the engine actually asks. */
export function buildSpritePrompt(params: SpriteReadParams): LLMMessage[] {
	const { labels, messages } = params;

	const template = featurePromptsStore.promptFor('sprites');
	// Global engine macros first ({{char}}, {{user}}, the history macros), then this flow's own
	// value on top, the two-phase idiom the opening scene uses for {{idea}}. {{labels}} is a
	// call-site key, deliberately NOT a macros.ts entry: it means nothing outside this call.
	const ctx = buildLiveMacroContext({ chatMessages: messages });
	const filled = substitute(template, {
		...resolveMacroValues(template, ctx),
		labels: labels.join('\n')
	});

	// The excerpt rides inside the filled template, so a single user turn is the shape every
	// provider accepts.
	return [{ role: 'user', content: filled }];
}

/** Read the newest turn and return the character's own label for it. The answer contract
 *  itself is pure and lives in `utils/sprites.ts` (`pickLabel`), where it is unit-tested. */
export async function readSprite(params: SpriteReadParams): Promise<string> {
	const { labels, messages, signal } = params;

	// Fail loud at the top: the caller gates on the same flag, so reaching here with it off
	// means something called in anyway (the generateOpeningScene / composer-transform style).
	if (!featurePromptsStore.spritesEnabled) {
		throw new Error('Sprites is turned off in Settings → Engines');
	}
	if (labels.length === 0) throw new Error('This character has no sprites to choose between');
	if (messages.length === 0) throw new Error('There is no turn to read');
	// The harder half of the registry's `requires` (architecture/engines.md): the editor warns
	// about a template that drops {{labels}}, and this refuses to run one. Without it the model
	// is asked to pick from a list it was never shown, and every answer fails the pool check:
	// a broken template reading as a broken model.
	if (!featurePromptsStore.promptFor('sprites').includes('{{labels}}')) {
		throw new Error('The Sprites prompt has no {{labels}}, so there is nothing to choose from');
	}

	const result = await llmService.complete(
		{ engine: 'sprites' },
		{ messages: buildSpritePrompt(params), source: 'sprites', signal }
	);

	return pickLabel(result.content, labels);
}
