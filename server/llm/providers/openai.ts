import type { ProviderProfile } from './types';

/**
 * OpenAI: the canonical /chat/completions endpoint. Its /models list is bare
 * (id + created only, both already standard-named), so no normalizeModel hook is
 * needed. Sampling support is a fixed allow-list: OpenAI documents temperature,
 * top_p, frequency_penalty, presence_penalty and seed, and takes max output under
 * `max_completion_tokens` (the modern field: reasoning models 400 on max_tokens).
 * It rejects top_k / min_p / top_a / repetition_penalty. It honours `service_tier`
 * (auto/default/flex/priority/scale). No account hook: OpenAI's Costs/Usage API
 * needs an org Admin key, not the inference key we hold here.
 */
export const openai: ProviderProfile = {
	name: 'openai',
	displayName: 'OpenAI',
	defaultBaseUrl: 'https://api.openai.com/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	paramPolicy: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed', 'max_completion_tokens'],
	serviceTier: true,
	// `reasoning_effort` (minimal/low/medium/high) on reasoning models (o-series, gpt-5).
	// /models is bare so there is no per-model gate. Sending it to a non-reasoning model
	// 400s loudly. Chat Completions never returns reasoning TEXT (Responses-API-only), so
	// there is no visibility control here.
	reasoning: {
		efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' }
	},
	// Vision is standard across current models; `detail` is documented (low/high/auto).
	media: { images: true, detail: true },
	// `verbosity` (low/medium/high) is honoured by the GPT-5 family on Chat Completions;
	// older models reject it loudly.
	verbosity: true,
	// Automatic server-side caching (≥1024-token prefixes); no field to send, no opt-out.
	// Reads report under usage.prompt_tokens_details.cached_tokens.
	caching: { mode: 'auto' }
};
