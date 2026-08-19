/**
 * Electron Hub: an OpenAI-compatible aggregator (450+ models) at
 * https://api.electronhub.ai/v1. Its /models does NOT self-report per-model
 * `supported_parameters`, so sampling support is a static allow-list of the
 * knobs the chat/completions reference documents. The /models fields are
 * non-standard (`tokens` for context, `pricing.input`/`pricing.output`), so a
 * normalize hook remaps them; GET /v1/user/me exposes the account balance.
 * Docs:
 *  - https://docs.electronhub.ai/api-reference/chat/completions
 *  - https://docs.electronhub.ai/api-reference/models
 *  - https://docs.electronhub.ai/api-reference/usage
 */
import type { ModelInfo, ProviderAccount } from '../types';
import type { ProviderProfile, ProviderRuntime } from './types';
import { num } from './util';

/**
 * Remap Electron Hub's non-standard /models fields onto ModelInfo. Context lives
 * under `tokens`; pricing uses `input`/`output` (per-token) instead of the
 * OpenRouter `prompt`/`completion` the generic normalizer reads.
 */
function normalizeModel(raw: Record<string, unknown>): Partial<ModelInfo> {
	const out: Partial<ModelInfo> = {};
	const ctx = num(raw.tokens);
	if (ctx !== undefined) out.contextLength = ctx;
	const pricing = raw.pricing as Record<string, unknown> | undefined;
	if (pricing) {
		const prompt = num(pricing.input);
		const completion = num(pricing.output);
		if (prompt !== undefined || completion !== undefined) out.pricing = { prompt, completion };
	}
	return out;
}

/**
 * Account snapshot from GET /v1/user/me, which a normal inference key (ek-…) can
 * hit with Bearer auth. `credits` is the remaining spendable balance (Electron
 * Hub's credit currency); there's no separate spend cap, so limit fields stay
 * null. The usage object is token counts, not a spend figure, so usage stays 0.
 */
async function fetchAccount(rt: ProviderRuntime): Promise<ProviderAccount> {
	const res = await rt.request('/user/me');
	if (!res.ok) throw new Error(await rt.extractError(res));
	const data = (await res.json()) as Record<string, unknown> | undefined;
	if (!data) throw new Error('Electron Hub returned an unexpected /user/me response');

	return {
		label: typeof data.subscription === 'string' ? data.subscription : null,
		limit: null,
		limitRemaining: null,
		limitReset: null,
		usage: 0,
		usageDaily: 0,
		usageWeekly: 0,
		usageMonthly: 0,
		isFreeTier: data.subscription === 'free',
		isManagementKey: false,
		expiresAt: null,
		balance: num(data.credits) ?? null
	};
}

export const electronhub: ProviderProfile = {
	name: 'electronhub',
	displayName: 'Electron Hub',
	defaultBaseUrl: 'https://api.electronhub.ai/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	// /models carries no supported_parameters, so allow-list the sampling knobs
	// the chat/completions reference documents (min_p, top_a, repetition_penalty,
	// seed, service_tier are not documented and are omitted).
	paramPolicy: ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'max_tokens'],
	// `reasoning_effort` (none→xhigh, silently ignored on non-reasoning models) plus
	// `reasoning: {exclude: true}` to strip reasoning from the response.
	reasoning: {
		efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'xhigh' },
		exclude: true
	},
	// image_url parts with a documented `detail` field are forwarded to vision models;
	// /models carries no modality flags, so no per-model gate.
	media: { images: true, detail: true },
	// Treated as automatic: caching is on across the catalog and reads are reported.
	// (It also accepts Anthropic-style cache_control for Claude routes, but that's
	// per-model, so it is kept out of the explicit path until it can be gated safely.)
	caching: { mode: 'auto' },
	normalizeModel,
	fetchAccount
};
