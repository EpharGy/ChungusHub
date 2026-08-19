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

/** Token count of `text` under the given encoding. */
export function encodingCount(text: string, encoding: EncodingName): number {
	if (!text) return 0;
	return encoding === 'cl100k_base' ? countCl100k(text) : countO200k(text);
}
