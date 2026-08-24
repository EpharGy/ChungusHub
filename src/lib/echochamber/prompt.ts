/**
 * Prompt assembly: a story snapshot in, an LLM message array out.
 *
 * The shape is ported deliberately unchanged from the extension, because it is a prompt
 * that was tuned against real models rather than a design anyone would arrive at cold.
 * One part of it looks like a mistake and is not: **`<chat_history>` is opened at the end
 * of the system message and closed at the start of the final user message**, with the
 * story's turns interleaved between them as real user/assistant turns. That frames the
 * history as a quoted transcript the crowd is reacting to, while still letting the model
 * see it as a conversation. Closing the tag in the system message instead leaves the turns
 * outside it, and models start continuing the story rather than reacting to it.
 *
 * Pure: no DOM, no `$lib`, no Svelte. `echochamber.test.ts` covers it directly.
 */

import type { ChatStyle, EchoChamberSettings, Reaction, StoryContext } from './types';

/** What the LLM service is handed. Structurally `LLMMessage`, without importing `$lib`. */
export interface PromptMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * Reasoning wrappers a PREVIOUS turn may still carry in its stored content, plus any stray
 * markup. The crowd is shown the story as a reader sees it, so a thinking block that was
 * hidden in the transcript stays hidden here.
 */
const THINKING_TAGS = /<(thinking|think|thought|reasoning|reason)>[\s\S]*?<\/\1>/gi;

function cleanTurn(text: string): string {
	return text.replace(THINKING_TAGS, '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Resolve the two macros that are EchoChamber's own.
 *
 * `{{user}}` and `{{char}}` are the app's ordinary macros and are already resolved by the
 * time a style's text reaches here; these two need the cast, which only this builder has.
 */
export function resolveStyleMacros(prompt: string, castNames: string[]): string {
	const names = castNames.filter((n) => n.trim());
	const characterList = names.length ? names.map((n) => `- ${n}`).join('\n') : '- Character';

	// A single-name cast is the case the extension calls out: in a one-card story the card's
	// name is usually the world or the story's title, not somebody who speaks, so naming it
	// as a chatter puts the book's title in the feed as a person.
	const storyCharactersBlock =
		names.length > 1
			? `<characters>\nThe ONLY chatters in this feed are the characters listed below. You MUST use each name EXACTLY as written - full surname included. Do NOT change, shorten, alter, or invent any part of any name. Do NOT add new characters not on this list:\n${characterList}\n</characters>`
			: `<characters>\nIdentify the speaking characters from the story content itself - do NOT use "${names[0] ?? 'Character'}" as a username, as that is the story or world name, not a character. Use the names of characters who actually appear and speak within the narrative. Each character should speak with the voice and personality they demonstrate in the story.\n</characters>`;

	return prompt
		.replace(/\{\{characters\}\}/gi, characterList)
		.replace(/\{\{story_characters_block\}\}/gi, storyCharactersBlock);
}

/** The `<lore>` block: everything about the world the crowd is allowed to know. */
function buildLore(context: StoryContext, settings: EchoChamberSettings): string {
	const parts: string[] = [];

	if (settings.includePersona && context.personaDescription.trim()) {
		parts.push(
			`<user_persona name="${context.personaName}">\n${context.personaDescription.trim()}\n</user_persona>`
		);
	}

	if (settings.includeCharacterDescription) {
		const described = context.characterDescriptions
			.filter((c) => c.description.trim())
			.map((c) => `<character name="${c.name}">\n${c.description.trim()}\n</character>`);
		if (described.length) parts.push(described.join('\n\n'));
	}

	if (settings.includeMemory && context.memory.trim()) {
		parts.push(`<summary>\n${context.memory.trim()}\n</summary>`);
	}

	if (settings.includeLorebook && context.lorebook.trim()) {
		parts.push(`<world_info>\n${context.lorebook.trim()}\n</world_info>`);
	}

	return parts.length ? `\n\n<lore>\n${parts.join('\n\n')}\n</lore>` : '';
}

/**
 * How many reactions to ask for, and from how many voices.
 *
 * A narrator style is one persona, so the count is a message count and the voice never
 * varies; a crowd style asks for one message each. The instruction is repeated in both the
 * instructions block and the task block on purpose - models drop the count when it is
 * stated once, and an over-long feed costs the reader tokens on every turn.
 */
function countInstruction(style: ChatStyle, count: number): string {
	if (style.narrator) {
		return `IMPORTANT: You MUST generate EXACTLY ${count} messages. Not fewer, not more - exactly ${count} messages from the same narrator/character.\n\n`;
	}
	return `IMPORTANT: You MUST generate EXACTLY ${count} chat messages. Not fewer, not more - exactly ${count}.\n\n`;
}

export interface BuiltPrompt {
	messages: PromptMessage[];
	/** What was asked for, so the parser's cap and the request agree. */
	requestedCount: number;
}

/**
 * Assemble the full request.
 *
 * `context.history` is already the turns to react to: the caller resolved the active path,
 * applied `contextDepth`, and dropped anything hidden, because all three need the story
 * tree and none of them belong in a pure builder.
 */
export function buildPrompt(
	style: ChatStyle,
	settings: EchoChamberSettings,
	context: StoryContext
): BuiltPrompt {
	const count = settings.reactionCount;
	const stylePrompt = resolveStyleMacros(style.prompt, context.castNames);

	const role = style.usesStoryCast
		? `<role>
You voice the actual characters from this roleplay as they react to the unfolding story in a live chat feed. Each character speaks authentically in their own established voice and personality - they are not random internet users, they are the story's cast.
</role>`
		: `<role>
You are an excellent creator of fake chat feeds that react dynamically to the user's conversation context.
</role>`;

	// See the file header: this tag is closed in the final user message, not here.
	const system = `${role}${buildLore(context, settings)}\n\n<chat_history>`;

	const messages: PromptMessage[] = [{ role: 'system', content: system }];

	for (let i = 0; i < context.history.length; i++) {
		const turn = context.history[i];
		let content = cleanTurn(turn.content);

		// The crowd's own past lines ride along with the turn they reacted to, so a running
		// joke, a nickname or an argument between two regulars can carry across turns.
		if (settings.includePastReactions) {
			const past = context.pastReactions[i];
			if (past?.length) {
				content += `\n\n[Previous EchoChamber commentary: ${formatPastReactions(past)}]`;
			}
		}

		messages.push({ role: turn.role, content });
	}

	const instructions = `</chat_history>

<instructions>
${countInstruction(style, count)}${stylePrompt}
</instructions>

<task>
Based on the chat history above, generate fake chat feed reactions. Remember to think about them step-by-step first.
STRICTLY follow the format defined in the instruction. Output exactly ${count} messages. Do NOT continue the story or roleplay as the characters. The people you create are allowed to interact with each other over your generated feed. Do NOT output preamble like "Here are the messages". Just output the content directly.
</task>`;

	messages.push({ role: 'user', content: instructions });

	return { messages, requestedCount: count };
}

/** Past reactions as one line, in the same `username: message` shape the model writes. */
function formatPastReactions(reactions: Reaction[]): string {
	return reactions.map((r) => `${r.username}: ${r.text}`).join(' | ');
}

/**
 * The crowd's earlier lines, indexed against the history window that carries them.
 *
 * **The target's own feed is never included.** A feed is generated for the newest turn, and
 * that turn is the last entry in its own history window, so a regenerate would otherwise be
 * shown the very output it is replacing and asked to keep its voice - which is precisely
 * what a reader pressing regenerate is trying to escape, and doubly so after deleting a feed
 * that came out corrupt. Only turns BEFORE the one being reacted to can be history.
 */
export function pastReactionsFor(
	history: readonly { id: string }[],
	targetId: string,
	feedFor: (messageId: string) => { reactions: Reaction[] } | null
): Record<number, Reaction[]> {
	const out: Record<number, Reaction[]> = {};
	history.forEach((turn, index) => {
		if (turn.id === targetId) return;
		const feed = feedFor(turn.id);
		if (feed?.reactions.length) out[index] = feed.reactions;
	});
	return out;
}

/**
 * The names a style's output should be snapped against, or none.
 *
 * Only a cast style snaps. A crowd style inventing `xX_ShadowReaper_Xx` is the feature, so
 * handing the parser a cast there would discard every line it generated. Kept here rather
 * than in the parser so that the builder and the parse of its reply read the same flag.
 *
 * **A cast of one does not snap either**, which is the extension's own rule and worth
 * keeping: one card usually names the story or the world rather than somebody who speaks,
 * so its cast list is not the set of people in the scene. Snapping against it would discard
 * every character the model correctly drew out of the narrative and leave an empty panel -
 * a far worse failure than an occasional name nobody recognises.
 */
export function castNamesForStyle(style: ChatStyle, context: StoryContext): string[] {
	if (!style.usesStoryCast) return [];
	const names = context.castNames.filter((n) => n.trim());
	return names.length > 1 ? names : [];
}
