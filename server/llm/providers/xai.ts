/**
 * xAI (Grok): OpenAI-compatible chat/completions at https://api.x.ai/v1, listed
 * live via the shared `${baseUrl}/models` (standard { data: [...] } shape). xAI
 * advertises OpenAI compatibility and documents the same sampling surface: temperature,
 * top_p, frequency_penalty, presence_penalty and seed, with output length under the
 * modern `max_completion_tokens` (max_tokens is deprecated). It does NOT document
 * top_k / min_p / top_a / repetition_penalty, so those stay out of the allow-list.
 * (frequency/presence penalties are documented API-wide but rejected by the reasoning
 * models and grok-3: setting them there 400s loudly rather than silently, which is
 * fine; the allow-list is provider-wide, not per-model.)
 *
 * /models is richer than OpenAI's bare listing: each entry carries a top-level
 * `context_length` (the generic pass already maps it) plus xAI's own token-price
 * keys, which normalizeModel converts to the app's USD-per-token convention. No
 * balance/usage endpoint is reachable with an inference key and no `service_tier`
 * is documented, so neither hook is wired.
 * Docs: https://docs.x.ai/docs/api-reference (POST /v1/chat/completions)
 *       https://docs.x.ai/developers/rest-api-reference/inference/models (GET /v1/models)
 */
import type { ModelInfo } from '../types';
import type { ProviderProfile } from './types';
import { num } from './util';

/**
 * Map xAI's /models card onto ModelInfo. The generic pass already reads the
 * top-level `context_length`; here we resolve xAI's own price keys. They are quoted
 * in USD cents per 100M tokens (e.g. grok-4 prompt = 30000 → $3 / 1M tokens), so we
 * divide by 1e10 to reach the USD-per-token figure the rest of the app (OpenRouter)
 * uses. Absent on a bare listing → num() yields undefined → we emit nothing.
 */
function normalizeModel(raw: Record<string, unknown>): Partial<ModelInfo> {
	const prompt = num(raw.prompt_text_token_price);
	const completion = num(raw.completion_text_token_price);
	if (prompt === undefined && completion === undefined) return {};
	return {
		pricing: {
			prompt: prompt !== undefined ? prompt / 1e10 : undefined,
			completion: completion !== undefined ? completion / 1e10 : undefined
		}
	};
}

export const xai: ProviderProfile = {
	name: 'xai',
	displayName: 'xAI (Grok)',
	defaultBaseUrl: 'https://api.x.ai/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	// OpenAI-compatible sampling surface whose field names match sampling.ts's fixed
	// apiField; max output goes under max_completion_tokens (max_tokens is deprecated).
	// top_k / min_p / top_a / repetition_penalty are undocumented for xAI (omitted).
	paramPolicy: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed', 'max_completion_tokens'],
	// `reasoning_effort` (low/medium/high) on reasoning models; non-reasoning models
	// 400 on it loudly. /models doesn't advertise reasoning, so no per-model gate.
	// reasoning_content comes back automatically where the model exposes it.
	reasoning: {
		efforts: { low: 'low', medium: 'medium', high: 'high' }
	},
	// Multimodal Grok models take image_url parts (base64 + https, jpg/png, 20MB);
	// `detail` (auto/low/high) is documented and honoured.
	media: { images: true, detail: true },
	// Automatic server-side caching (sticky routing); no cache_control field, no opt-out.
	// Reads report under usage.prompt_tokens_details.cached_tokens.
	caching: { mode: 'auto' },
	normalizeModel
	// No inference-key-reachable balance/usage endpoint and no service_tier in the xAI API.
};
