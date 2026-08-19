/**
 * Perplexity (Sonar): OpenAI-compatible chat at `${baseUrl}/chat/completions`
 * (both `/chat/completions` and `/v1/chat/completions` resolve off the base).
 *
 * Strict, tiny sampling surface: the current API documents only `temperature`,
 * `top_p` and `max_tokens` for Sonar, with `top_k`, `presence_penalty` and
 * `frequency_penalty` absent from the reference, so the allow-list carries just
 * those. Names match our fixed apiFields 1:1 (temperature, top_p, max_tokens).
 *
 * No usable /models: the shared class lists via `${baseUrl}/models`, but
 * Perplexity has no chat /models endpoint there. The only listing is the
 * Agent-API-scoped `GET /v1/models` (different path + scope), so model listing
 * will fail. That's a shared-layer call, not something this profile can fix.
 * No balance endpoint (dashboard-only, 402 on empty) and no service_tier.
 */
import type { ProviderProfile } from './types';

export const perplexity: ProviderProfile = {
	name: 'perplexity',
	displayName: 'Perplexity',
	defaultBaseUrl: 'https://api.perplexity.ai',
	requiresApiKey: true,
	baseUrlEditable: false,
	paramPolicy: ['temperature', 'top_p', 'max_tokens'],
	// `reasoning_effort` (minimal/low/medium/high) on the reasoning Sonar models;
	// other models reject it loudly. Reasoning arrives inline as <think> tags (our
	// stream parser already extracts those) and can't be hidden or disabled.
	reasoning: {
		efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' }
	},
	// sonar / sonar-pro accept image_url parts (base64 ≤50MB or public https);
	// `detail` is undocumented, so it stays off.
	media: { images: true },
	// Automatic caching (Perplexity prices cache reads per model); no cache_control
	// field is documented, so we never send one and only report the cache reads.
	caching: { mode: 'auto' }
};
