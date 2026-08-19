/**
 * Google AI Studio (Gemini) via its OpenAI-compatibility layer. The compat
 * /chat/completions documents a narrow slice of OpenAI sampling fields:
 * temperature, top_p, frequency_penalty, presence_penalty and seed are accepted
 * and genuinely honoured (Gemini has native frequency/presence penalties), so
 * they form the allow-list. max_tokens is universal (sent by the shared class).
 * Everything else is deliberately OUT:
 *   - top_k is Gemini-native but NOT a compat field, reachable only through
 *     extra_body.google (generationConfig.topK), which this layer doesn't build,
 *     so surfacing a Top K slider would silently do nothing.
 *   - min_p / top_a / repetition_penalty aren't Gemini concepts at all.
 * service_tier is supported ("matches OpenAI's service_tier in name and logic",
 * flex/priority) and Gemini is in sampling.ts's tier-author allowlist, so we opt
 * in. /models is standard OpenAI shape (id/object/owned_by) with no field mapping
 * needed, and there is no key balance/usage endpoint, so no account snapshot.
 * Docs: https://ai.google.dev/gemini-api/docs/openai
 */
import type { ProviderProfile } from './types';

export const googleaistudio: ProviderProfile = {
	name: 'googleaistudio',
	displayName: 'Google AI Studio',
	defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
	requiresApiKey: true,
	baseUrlEditable: false,
	// OpenAI-compat sampling fields Gemini documents + honours (max_tokens universal).
	paramPolicy: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'],
	serviceTier: true,
	// `reasoning_effort` maps to thinking_level internally (none disables thinking on
	// models that allow it). Thinking-text visibility only exists via extra_body.google
	// include_thoughts, whose response shape our parser doesn't speak, so it is not offered.
	reasoning: {
		efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' }
	},
	// Every current Gemini model is vision-capable; base64 data URLs documented.
	// image_url.detail is silently ignored by the compat layer, so it stays off.
	media: { images: true },
	// Implicit automatic caching on Gemini 2.5+ (explicit cached-content objects need a
	// separate API we don't drive); no cache_control on the compat layer, no opt-out.
	// Reads report under usage.total_cached_tokens.
	caching: { mode: 'auto' }
};
