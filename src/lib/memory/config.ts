/**
 * Memory engine tunables.
 *
 * Defaults are tuned for roleplay turns, which are far longer than the chat-app DMs the
 * original engine was built for, so batches and the verbatim tail are counted in a
 * handful of exchanges, not dozens of one-liners.
 *
 * The tail is deliberately wider than a batch. The newest exchanges are what the model leans
 * on for voice, tone and the thread of the scene in play, and a summary standing in for them
 * is what makes a story read as though it forgot the last few minutes. A batch narrower than
 * the tail also folds in smaller steps, so an edit or a delete over a folded turn destroys
 * less and costs a shorter re-read.
 *
 * Note what is deliberately NOT a tunable: how many episodes reach the prompt. Recall
 * renders every stored episode, and the layer caps below are what bound their NUMBER. A
 * separate recall cap was a phantom lever: it hid whole batches from the model while
 * their messages were already dropped from the live history, so a band of the story was
 * neither shown nor recalled. Bounding the count happens in one place now, by construction.
 *
 * What nothing here bounds is the block's SIZE. Episode length is set by the templates, not
 * by these numbers, and it compounds: each merge targets about half the length of what it
 * consumed while consuming `promoteCount` episodes, and the top layer re-merges in place
 * under an unchanged cap. A saturated ladder on these defaults runs to several thousand
 * tokens, which is deliberately left to the reader's own context size rather than capped
 * here. See the recall budget note in architecture/memory.md before adding a lever for it.
 */

import type { MemoryConfig } from './types';

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	batchSize: 8,
	verbatimTail: 16,
	maxPerLayer: 12,
	promoteCount: 4,
	maxLayers: 3
};

/**
 * How many of the newest layer-0 episodes are shown to the extractor as "already
 * summarised, do not restate". Purely an extraction-prompt window: it bounds that
 * prompt's size and has no say in what reaches the story prompt.
 */
export const EXTRACT_CONTEXT_EPISODES = 6;

/**
 * Batches the *automatic* post-turn pass may run at once. Ordinary play produces one batch
 * every `batchSize` turns, so this never binds there. It binds when a branch change or a
 * deleted stretch leaves a long backlog, where an uncapped catch-up would spend dozens of
 * sequential calls unasked, on a trigger as small as sending a message. The backlog is
 * worked off a few batches per turn instead, and the panel's Summarise is there for anyone
 * who wants it now.
 *
 * It lives here rather than in the store because it is also the cap a confirmation has to
 * respect: a rewrite owing nine passes does not get them from one reply, and saying it does
 * is a promise the loop never keeps (`impact-copy.ts`).
 */
export const AUTO_MAX_BATCHES = 3;

/**
 * Per-field guard rails for values coming from the panel / stored overrides.
 *
 * `verbatimTail` bottoms out at 1, not 0. A tail of 0 lets the boundary reach the leaf, and
 * the turn at the leaf is the one being answered. `{{chatHistory}}` filters archived ids, so
 * archiving that turn drops it out of its own prompt, leaving a summary to speak for the very
 * message the model is replying to. One is the smallest tail where "the turn being answered
 * is always live" holds.
 */
const BOUNDS: Record<keyof MemoryConfig, { min: number; max: number }> = {
	batchSize: { min: 2, max: 60 },
	verbatimTail: { min: 1, max: 60 },
	maxPerLayer: { min: 3, max: 60 },
	promoteCount: { min: 2, max: 30 },
	maxLayers: { min: 1, max: 6 }
};

function clampField(key: keyof MemoryConfig, value: number): number {
	const { min, max } = BOUNDS[key];
	if (!Number.isFinite(value)) return DEFAULT_MEMORY_CONFIG[key];
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** Merge a partial override onto the defaults, clamping every field to a safe range. */
export function resolveConfig(override?: Partial<MemoryConfig> | null): MemoryConfig {
	const out = { ...DEFAULT_MEMORY_CONFIG };
	if (!override) return out;
	for (const key of Object.keys(BOUNDS) as (keyof MemoryConfig)[]) {
		const v = override[key];
		if (typeof v === 'number') out[key] = clampField(key, v);
	}
	// promoteCount can't exceed maxPerLayer or promotion would never fire.
	if (out.promoteCount > out.maxPerLayer) out.promoteCount = out.maxPerLayer;
	return out;
}
