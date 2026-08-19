<script lang="ts">
	/**
	 * Approval: how much the assistant asks before it acts.
	 *
	 * What is set here is the DEFAULT a new tab is born with, not a lock: the pill beside each
	 * composer moves that tab on its own, and that per-tab choice is deliberately forgotten on
	 * reload so a tab loosened for one long job falls back to this. The mode never reaches the
	 * model: it touches neither the system prompt nor the tool list, so changing it costs no
	 * prompt cache and no resend, which is why there is no Apply notice attached to it.
	 *
	 * The two choices, Auto's badge and its warning come from $lib/config/assistant-approval
	 * so this page and the composer's pill cannot describe the same switch two different ways.
	 */
	import { onMount } from 'svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { APPROVAL_MODES, readApprovalMode, type ApprovalModeInfo } from '$lib/config/assistant-approval';
	import { db } from '$lib/services/database';
	import { registerSettingsReload } from '$lib/services/syncedSetting';
	import { assistantSessionStore } from '$lib/stores/assistantSessions.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import type { ApprovalMode } from '$lib/types/assistant';

	const MODE_SETTING = 'assistantApprovalMode';

	let mode = $state<ApprovalMode>(readApprovalMode(null));
	let loaded = $state(false);
	/** The loose mode waiting on its confirmation, if one is. */
	let pending = $state<ApprovalModeInfo | null>(null);

	async function load(): Promise<void> {
		try {
			mode = readApprovalMode(await db.getSetting(MODE_SETTING));
			loaded = true;
		} catch (e) {
			toastStore.failed('load the approval settings', e);
		}
	}

	/** Loosening asks first, every time: it is the one direction that can lose work, and a
	 *  question asked once at setup is one nobody remembers answering months later. */
	function pickMode(choice: ApprovalModeInfo): void {
		if (choice.mode === mode) return;
		if (choice.warning) pending = choice;
		else void commitMode(choice.mode);
	}

	async function commitMode(next: ApprovalMode): Promise<void> {
		const previous = mode;
		mode = next;
		pending = null;
		try {
			await db.setSetting(MODE_SETTING, next);
			// The store hands this value to every new tab, so it has to hear the change now
			// rather than at the next boot.
			await assistantSessionStore.refreshApprovalDefaults();
		} catch (e) {
			mode = previous;
			toastStore.failed('save the approval mode', e);
		}
	}

	onMount(() => {
		void load();
		// An ordinary setting, so another device changing it must reach this page: a stale
		// value left open here would be re-saved over the newer one.
		return registerSettingsReload(load);
	});
</script>

<div class="apr-modes" role="radiogroup" aria-label="Default approval mode">
	{#each APPROVAL_MODES as choice (choice.mode)}
		<button
			type="button"
			role="radio"
			aria-checked={mode === choice.mode}
			class="apr-mode"
			class:apr-mode--on={mode === choice.mode}
			class:apr-mode--critical={!!choice.badge}
			disabled={!loaded}
			onclick={() => pickMode(choice)}
		>
			<span class="apr-mode-head">
				<span class="apr-mode-label">{choice.label}</span>
				{#if choice.badge}
					<span class="apr-badge">{choice.badge}</span>
				{/if}
			</span>
			<span class="apr-mode-describe">{choice.describe}</span>
		</button>
	{/each}
</div>

<ConfirmDialog
	open={!!pending}
	title={pending?.warning?.title ?? ''}
	message={pending?.warning?.message ?? ''}
	confirmLabel={pending?.warning?.confirmLabel ?? ''}
	variant="danger"
	onConfirm={() => pending && void commitMode(pending.mode)}
	onCancel={() => (pending = null)}
/>

<style>
	.apr-modes {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.apr-mode {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 86%, transparent);
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, border-color 120ms ease;
	}

	.apr-mode:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.apr-mode--on {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	/* The mode that reviews nothing wears its own colour once chosen: the accent says "this is
	   set", and this one also has to say that no review is running. */
	.apr-mode--critical.apr-mode--on {
		border-color: color-mix(in srgb, var(--color-error) 55%, transparent);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.apr-mode:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.apr-mode-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.apr-mode-label {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	/* Same badge the Capabilities page marks an experimental family with, for the same
	   reason: it is on whether or not the row is chosen. */
	.apr-badge {
		flex-shrink: 0;
		padding: 0.08rem 0.4rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-error) 45%, transparent);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		color: var(--color-error);
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.apr-mode-describe {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.35;
		color: var(--color-text-muted);
	}
</style>
