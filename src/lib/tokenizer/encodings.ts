/**
 * Local BPE encodings. We only ship the two OpenAI families gpt-tokenizer provides; every
 * other model (Claude, Llama, Gemini, DeepSeek, Qwen…) has no faithful local tokenizer, so
 * it rides o200k as a base estimate and the calibration layer corrects the per-model offset
 * from real usage. This is a small FAMILY map resolved from the model id (never a per-model
 * table), so new models work without any code change.
 */

import { countTokens as countCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { countTokens as countO200k } from 'gpt-tokenizer/encoding/o200k_base';

export type EncodingName = 'o200k_base' | 'cl100k_base';

/** Pick the closest local encoding for a model id. */
export function resolveEncoding(model?: string): EncodingName {
	const id = (model ?? '').toLowerCase();
	// Modern OpenAI uses o200k even though the id still contains "gpt-4"; rule it out first so
	// the legacy test below can't steal gpt-4o / gpt-4.1.
	const isModernGpt = /gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o/.test(id);
	if (!isModernGpt && /gpt-4|gpt-3\.5|gpt-35/.test(id)) return 'cl100k_base';
	// o200k for modern OpenAI and as the base estimate for everything else.
	return 'o200k_base';
}

/**
 * Counted strings, per encoding.
 *
 * BPE encoding is PURE: the same text under the same encoding is the same number forever,
 * with no clock, no config and no state behind it. So there is nothing here to invalidate.
 * An edited message is a different string, which is a different key, which is a miss that
 * computes the right answer. That is the whole safety argument for this cache.
 *
 * It earns its place because the reactive meters re-assemble the ENTIRE prompt whenever any
 * store they read changes, and most of those changes have nothing to do with the chat. Type
 * one character into a lorebook entry and `lorebookStore` reassigns its books, which
 * invalidates the composer's assembly, which re-counts every live turn in the chat -- twice,
 * since the budget trim sums the whole history before deciding most of it does not fit. On a
 * long chat whose memory is behind (turns waiting on a summary are sent verbatim, and priced
 * every time), that is over a million tokens of BPE per keystroke.
 *
 * Keyed per encoding rather than by a composite key: the same text genuinely counts
 * differently under cl100k and o200k, so one shared map would return a wrong number, and a
 * composite key would allocate a copy of every message string on every lookup.
 *
 * Keys are references to strings the caller already holds (message contents live in the chat
 * store regardless), so the added footprint is the map's own overhead and not the text. The
 * cap is a safety valve for the strings that ARE transient -- expanded templates, rendered
 * lorebook blocks -- and is set well above the working set of a long chat so that an ordinary
 * assembly never trips it. Dropped wholesale rather than one key at a time, the same shape as
 * the prompt-debug panel's estimate cache: callers here sweep the whole history in order, and
 * a per-key eviction under that pattern discards exactly what the next pass is about to ask
 * for.
 */
export const COUNT_CACHE_MAX = 20000;
const caches: Record<EncodingName, Map<string, number>> = {
	o200k_base: new Map(),
	cl100k_base: new Map()
};

/** Token count of `text` under the given encoding. */
export function encodingCount(text: string, encoding: EncodingName): number {
	if (!text) return 0;
	const cache = caches[encoding];
	const hit = cache.get(text);
	if (hit !== undefined) return hit;
	const count = encoding === 'cl100k_base' ? countCl100k(text) : countO200k(text);
	if (cache.size >= COUNT_CACHE_MAX) cache.clear();
	cache.set(text, count);
	return count;
}
