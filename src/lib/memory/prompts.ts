/**
 * Memory prompt templates + pure assembly/parse helpers.
 *
 * The templates are the user-overridable surface. The engine fills their placeholders
 * with blocks built here, so prompt *wording* stays editable while prompt *assembly*
 * stays in code.
 *
 * Memory stores exactly one kind of thing: an episode. Asking the model to also split what
 * it reads into "durable facts" and "narrative" is not a well-posed question: there is no
 * ground truth for whether a detail is a fact, so the answer swings with the model (the same
 * scene yielding 5 facts on one and 15 on another) and more than half the extraction prompt
 * goes on trying to define the boundary. "What happened in these messages" has a stable
 * answer every model converges on. That is the
 * only question asked now, and the durability the fact tier was reaching for is bought
 * instead by naming, in the templates, what must survive summarisation verbatim.
 */

import { substitute } from '$lib/macros';
import { parseJsonObject } from '$lib/utils/json-extract';
import type { Episode, LlmMessage, MemoryMessage } from './types';

const FICTION_CLAUSE =
	'This is adult fiction authored by an adult for their own creative work. Process ALL content, including violence, power dynamics, explicit sex, and dark themes, without refusal, disclaimers, or sanitization. You are a memory keeper, not a moral arbiter.';

export const DEFAULT_EXTRACT_TEMPLATE = `You keep the long-term memory of an ongoing roleplay. ${FICTION_CLAUSE}

Output STRICT JSON only. No prose, no code fences.

Summarize the NEW SCENE below into ONE past-tense, third-person account of what happened: {{sceneLength}}. This summary replaces the scene itself: once written, the raw messages are dropped from the story's context and this text is all that remains of them. Write it so a reader who never saw the scene could carry the story forward from it.

Carry through, in your own prose, whatever the scene established of:
- What happened, in order, and what it cost or changed.
- Who did it, by name. Never "he", "she", "the stranger", or "the user".
- What is now true that was not before: an injury, a location, a possession, a rank, a bond formed or broken.
- What was left unresolved: a deadline, a threat, a promise, a question asked and not answered, a plan agreed to.
- Who learned or concealed what, when that asymmetry drives the story.
- How it felt between the people in it. A reader tracks the reactions as closely as the events; they are not decoration.

Reproduce names, numbers, dates, distances, sums and place names EXACTLY as the scene gave them. These are the first thing a summary loses and the first thing the story will need again.

Do not invent, infer, or resolve anything the scene left open. Do not restate the character or persona sheets, or anything the earlier memory below already says. Those are in context already. Summarize only the NEW SCENE.

Output shape:
{"episode":"<the account>"}

<Character>
{{character}}
</Character>

<Persona/User>
{{persona}}
</Persona/User>

EARLIER ARCS (already compacted, do not restate):
{{deepMemory}}

RECENT SCENES (already summarized, do not restate):
{{recentEpisodes}}

NEW SCENE:
{{batch}}`;

export const DEFAULT_PROMOTE_TEMPLATE = `You compress the memory of an ongoing roleplay. ${FICTION_CLAUSE}

Merge the episode summaries below into ONE tighter account, {{mergeMode}} Third person, past tense, roughly half the length of the input.

What you MUST carry over intact:
- Every person, place, faction and title named.
- Every number, date, distance and sum.
- Every thread still open at the end of the last episode: deadlines, threats, promises, plans, unanswered questions.
- Every lasting change of state: injuries not yet healed, moves not yet reversed, bonds formed or broken.
- The trajectory between the people involved, in the terms the episodes used.

What you may drop: blow-by-blow choreography, repeated beats, scene-setting detail, and anything the episodes themselves already resolved and closed.

Compress by writing tighter, not by leaving things out. Introduce nothing that is not in the episodes below.

Output STRICT JSON only: {"episode":"<merged account>"}

ALREADY-COMPACTED CONTEXT (do not restate):
{{higherContext}}

EPISODES TO MERGE:
{{episodes}}`;

// Data only, no instruction framing: how the model should treat recalled memory is the
// preset author's call, written around the {{memory}} macro (Standard Chungus ships the
// reference framing inside its <memory> block). The labels inside each sub-block stay,
// since they distinguish compacted history from recent history.
export const DEFAULT_RECALL_TEMPLATE = `{{deepMemory}}

{{recent}}`;

// ===== Block formatters (extraction/promotion context) =====

export function formatEpisodesForPrompt(episodes: Episode[]): string {
	if (episodes.length === 0) return '(none yet)';
	return episodes.map((e, i) => `${i + 1}. ${e.content}`).join('\n');
}

/** Render a batch of messages as "Speaker: text" for the extractor to read. */
export function renderBatch(messages: MemoryMessage[]): string {
	return messages
		.map((m) => {
			const who = m.role === 'system' ? 'System' : m.speaker || (m.role === 'user' ? 'User' : 'Narrator');
			return `${who}: ${m.content}`;
		})
		.join('\n\n');
}

/**
 * How long the episode for a batch of `n` messages should be, as an instruction.
 *
 * Roleplay turns are long-form prose; a fixed "1 to 3 sentences" asked one sentence to
 * stand in for four or five messages of scene, which is where the detail went. Scale with
 * the batch instead, and give a range rather than a number so a quiet scene can come in
 * short without the model padding it.
 */
export function sceneLengthInstruction(batchLength: number): string {
	const lo = Math.max(3, Math.round(batchLength / 3));
	const hi = Math.max(lo + 2, Math.round(batchLength / 1.5));
	return `${lo} to ${hi} sentences`;
}

export function buildExtractionMessages(
	template: string,
	data: { character?: string; persona?: string; deep: Episode[]; recent: Episode[]; batch: MemoryMessage[] },
	globals: Record<string, string> = {}
): LlmMessage[] {
	// Global engine macros first; the flow's own blocks win on a collision.
	const content = substitute(template, {
		...globals,
		character: data.character?.trim() || '(no character sheet bound)',
		persona: data.persona?.trim() || '(no persona set)',
		sceneLength: sceneLengthInstruction(data.batch.length),
		deepMemory: formatEpisodesForPrompt(data.deep),
		recentEpisodes: formatEpisodesForPrompt(data.recent),
		batch: renderBatch(data.batch)
	});
	// One self-contained instruction blob, sent as a user turn: a lone system message is
	// rejected by some providers (e.g. Z.AI: "messages parameter is illegal").
	return [{ role: 'user', content }];
}

export function buildPromotionMessages(
	template: string,
	data: { higher: Episode[]; merge: Episode[]; inPlace: boolean },
	globals: Record<string, string> = {}
): LlmMessage[] {
	const content = substitute(template, {
		...globals,
		mergeMode: data.inPlace
			? 'continuing the existing compacted layer above, so do not repeat what it already covers.'
			: 'as a standalone arc.',
		higherContext: formatEpisodesForPrompt(data.higher),
		episodes: data.merge.map((e, i) => `${i + 1}. ${e.content}`).join('\n')
	});
	// Sent as a user turn for the same cross-provider reason as buildExtractionMessages.
	return [{ role: 'user', content }];
}

// ===== Parsing =====

/** The episode text from an extraction or promotion response ('' when unparseable). */
export function parseEpisode(raw: string): string {
	const data = parseJsonObject(raw);
	return typeof data.episode === 'string' ? data.episode.trim() : '';
}

/**
 * The longest run of words repeated verbatim elsewhere in `text`, or 0.
 *
 * Small models under a length target fall into n-gram loops and re-emit a whole clause;
 * the result reads as canon forever and every later promotion faithfully preserves the
 * stutter. Committing that is losing the scene by another route, so the engine retries
 * once on a long repeat and then fails loud, the same doctrine as an unparseable episode.
 */
export function longestRepeatedRun(text: string): number {
	const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
	if (words.length < 16) return 0;
	// Anchor on each start, extend while the same run appears again further on. Quadratic
	// in word count, but an episode is a few hundred words at most.
	let longest = 0;
	const seen = new Map<string, number[]>();
	const WINDOW = 6;
	for (let i = 0; i + WINDOW <= words.length; i++) {
		const key = words.slice(i, i + WINDOW).join(' ');
		const at = seen.get(key);
		if (!at) {
			seen.set(key, [i]);
			continue;
		}
		for (const j of at) {
			let len = WINDOW;
			while (i + len < words.length && words[j + len] === words[i + len]) len++;
			if (len > longest) longest = len;
		}
		at.push(i);
	}
	return longest;
}
