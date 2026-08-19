/**
 * DeepSeek: OpenAI-compatible, but a strict API whose /chat/completions only
 * honours temperature + top_p (max_tokens is universal). frequency_penalty and
 * presence_penalty are documented as no-ops ("no longer supported"), so they are
 * deliberately kept OUT of the allow-list. Showing sliders that silently do
 * nothing would be a silent failure. /models is bare {id, object, owned_by}
 * (no field mapping needed), and it exposes a balance endpoint that auto-enables
 * the connection ledger.
 * Docs: https://api-docs.deepseek.com/api/create-chat-completion
 *       https://api-docs.deepseek.com/api/list-models
 *       https://api-docs.deepseek.com/api/get-user-balance
 */
import type { ProviderAccount } from '../types';
import type { ProviderProfile, ProviderRuntime } from './types';
import { num } from './util';

/**
 * GET /user/balance → { is_available, balance_infos: [{ currency, total_balance,
 * granted_balance, topped_up_balance }] }. total_balance is a numeric STRING (num()
 * parses it). The array can carry both CNY and USD wallets; we map the first entry.
 */
async function fetchAccount(rt: ProviderRuntime): Promise<ProviderAccount> {
	const res = await rt.request('/user/balance');
	if (!res.ok) throw new Error(await rt.extractError(res));
	const data = (await res.json()) as Record<string, unknown> | undefined;
	const infos = data?.balance_infos;
	if (!Array.isArray(infos) || infos.length === 0) throw new Error('DeepSeek returned an unexpected /user/balance response');

	const info = infos[0] as Record<string, unknown>;
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
		balance: num(info.total_balance) ?? null
	};
}

export const deepseek: ProviderProfile = {
	name: 'deepseek',
	displayName: 'Deepseek',
	defaultBaseUrl: 'https://api.deepseek.com',
	requiresApiKey: true,
	baseUrlEditable: false,
	// Strict API: only temperature + top_p are honoured (max_tokens is universal).
	paramPolicy: ['temperature', 'top_p'],
	// Thinking mode: `thinking: {type: "disabled"}` turns reasoning off entirely;
	// `reasoning_effort` only documents "high" and "max" (422 on other values).
	// Reasoning text always comes back as reasoning_content when thinking, with
	// no separate visibility control. No vision models on this API.
	reasoning: {
		efforts: { high: 'high', max: 'max' },
		offViaThinking: true
	},
	// Automatic context caching (on by default, 64-token boundaries); no field, no opt-out.
	// Reads report under usage.prompt_cache_hit_tokens.
	caching: { mode: 'auto' },
	fetchAccount
};
