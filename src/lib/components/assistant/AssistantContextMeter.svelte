<script lang="ts">
	/**
	 * Context meter: real provider-reported occupancy of the active tab. Tool results
	 * are never shortened; near the window the server drops the OLDEST whole turns
	 * (with a note the model sees). The meter shows where the tab stands, and past
	 * the warn threshold it offers the real remedy inline: a fresh tab.
	 */
	import { assistantSessionStore } from '$lib/stores/assistantSessions.svelte';
	import { connectionStore } from '$lib/stores/connections.svelte';

	interface Props {
		onNewTab: () => void;
	}
	let { onNewTab }: Props = $props();

	const store = assistantSessionStore;

	let activeId = $derived(store.activeTabId);
	let used = $derived(activeId ? store.contextTokens(activeId) : null);
	/** The Assistant connection's declared context size, the same number the server
	 *  trims this tab's working memory against. */
	let limit = $derived(activeId ? (connectionStore.connectionFor('assistant')?.contextSize ?? null) : null);
	let pct = $derived(used && limit ? Math.min(100, Math.round((used / limit) * 100)) : null);

	/** Compact token count: 843 → "843", 12480 → "12.5k". */
	function fmtTokens(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}
</script>

{#if activeId && used}
	<div
		class="assistant-ctx"
		class:assistant-ctx--warn={pct !== null && pct >= 80 && pct < 95}
		class:assistant-ctx--danger={pct !== null && pct >= 95}
		title={limit
			? `This tab's conversation occupies ${fmtTokens(used)} of the Assistant connection's ${fmtTokens(limit)}-token context size. Near the top the oldest turns start dropping out, so open a new tab for unrelated work or raise Context Size on that connection.`
			: `This tab's conversation currently occupies ${fmtTokens(used)} tokens (no connection is assigned to the Assistant).`}
	>
		{#if limit && pct !== null}
			<div class="assistant-ctx-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Context window usage">
				<div class="assistant-ctx-fill" style:width="{pct}%"></div>
			</div>
		{/if}
		<span class="assistant-ctx-num">{fmtTokens(used)}{limit ? ` / ${fmtTokens(limit)} · ${pct}%` : ' ctx'}</span>
		{#if pct !== null && pct >= 80}
			<button type="button" class="assistant-ctx-newtab" onclick={onNewTab} title="Start a fresh tab, this one keeps its transcript">
				New tab
			</button>
		{/if}
	</div>
{/if}

<style>
	.assistant-ctx {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 0.15rem 0.35rem;
		cursor: default;
	}

	.assistant-ctx-bar {
		width: 5.5rem;
		height: 3px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-text-muted) 18%, transparent);
		overflow: hidden;
	}

	.assistant-ctx-fill {
		height: 100%;
		border-radius: inherit;
		background: color-mix(in srgb, var(--color-accent) 65%, transparent);
		transition: width 300ms ease;
	}

	.assistant-ctx-num {
		font-size: 0.64rem;
		font-family: var(--font-mono, monospace);
		color: var(--color-text-muted);
		opacity: 0.8;
		white-space: nowrap;
	}

	.assistant-ctx-newtab {
		flex-shrink: 0;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.64rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.assistant-ctx-newtab:hover {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-ctx--warn .assistant-ctx-fill {
		background: color-mix(in srgb, var(--color-warning) 75%, transparent);
	}

	.assistant-ctx--warn .assistant-ctx-num {
		color: var(--color-warning);
	}

	.assistant-ctx--danger .assistant-ctx-fill {
		background: color-mix(in srgb, var(--color-error) 80%, transparent);
	}

	.assistant-ctx--danger .assistant-ctx-num {
		color: var(--color-error);
		opacity: 1;
	}
</style>
