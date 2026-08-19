/**
 * Moonshot AI (Kimi): OpenAI-compatible chat/completions + /models, with a
 * dedicated balance endpoint that auto-enables the connection ledger. The API
 * only accepts a small, fixed set of sampling knobs (temperature, top_p,
 * frequency_penalty, presence_penalty) on the moonshot-v1 models (no top_k /
 * min_p / repetition_penalty / seed), and max_tokens is deprecated in favour of
 * max_completion_tokens, so the allow-list carries exactly those names.
 * Docs: https://platform.moonshot.ai/docs/api/chat and .../docs/api/balance
 * (both 301 to https://platform.kimi.ai/docs/api/...).
 */
import type { ModelInfo, ProviderAccount } from '../types';
import type { ProviderProfile, ProviderRuntime } from './types';
import { jsonObject, num } from './util';

/**
 * Map Moonshot's rich /models flags onto ModelInfo. Kimi advertises capability
 * booleans the generic pass doesn't know: supports_image_in → vision modality,
 * supports_reasoning → reasoning badge (also gates the reasoning controls).
 */
function normalizeModel(raw: Record<string, unknown>): Partial<ModelInfo> {
	const out: Partial<ModelInfo> = {};
	if (typeof raw.supports_image_in === 'boolean') {
		out.inputModalities = raw.supports_image_in ? ['text', 'image'] : ['text'];
	}
	if (raw.supports_reasoning === true) out.isReasoning = true;
	return out;
}

/**
 * Account snapshot from GET /v1/users/me/balance. The response wraps the figures
 * in a `data` object: `available_balance` (cash + voucher, USD) is the spendable
 * total we surface as the ledger balance; Moonshot has no per-key limit/usage
 * feed, so those stay null/0.
 * Shape: { code, data: { available_balance, voucher_balance, cash_balance }, scode, status }
 */
async function fetchAccount(rt: ProviderRuntime): Promise<ProviderAccount> {
	const res = await rt.request('/users/me/balance');
	if (!res.ok) throw new Error(await rt.extractError(res));
	const data = (await jsonObject(res)).data as Record<string, unknown> | undefined;
	if (!data) throw new Error('Moonshot returned an unexpected /users/me/balance response');

	return {
		label: null,
		limit: null,
		limitRemaining: null,
		limitReset: null,
		usage: 0,
		usageDaily: 0,
		usageWeekly: 0,
		usageMonthly: 0,
		isFreeTier: false,
		isManagementKey: false,
		expiresAt: null,
		balance: num(data.available_balance) ?? null
	};
}

export const moonshot: ProviderProfile = {
	name: 'moonshot',
	displayName: 'Moonshot AI',
	defaultBaseUrl: 'https://api.moonshot.ai/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	// moonshot-v1 documents temperature, top_p, frequency_penalty, presence_penalty;
	// max_tokens is deprecated, so we send output length under max_completion_tokens.
	paramPolicy: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'max_completion_tokens'],
	// Kimi thinking is on/off only (`thinking: {type: "disabled"}`), with no effort levels.
	// reasoning_content always returns when thinking; gated on supports_reasoning.
	reasoning: {
		offViaThinking: true,
		gate: 'model'
	},
	// Vision models take image_url parts (base64, png/jpeg/webp/gif); gated on
	// supports_image_in. No image_url.detail in the Kimi API.
	media: { images: true, gate: 'model' },
	// Automatic context caching (implicit); no cache_control field, no opt-out.
	// Reads report under top-level usage.cached_tokens.
	caching: { mode: 'auto' },
	normalizeModel,
	fetchAccount
};
