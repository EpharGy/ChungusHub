<script lang="ts">
	/**
	 * Frameworks settings page: the overview. Every framework is one row: icon, name,
	 * one-line summary, and whether this install carries it at all. Everything deeper lives
	 * in the detail view a row drills into (FrameworkDetail, keyed off
	 * uiStore.settingsFrameworkId exactly like the Engines page).
	 *
	 * **This switch is availability, not use.** It says whether a framework is offered to
	 * chats at all; whether a given story turns it on is that chat's own decision, made on
	 * the frameworks panel. Same split Memory has, and the reason is the same: an install is
	 * the thing that decides whether a system exists, and a story is the thing that decides
	 * whether it wants one.
	 *
	 * Everything on this page is therefore app-wide. A control that quietly edited whichever
	 * chat happened to be open would be a nasty surprise in a Settings window.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import FrameworkDetail from './FrameworkDetail.svelte';
	import { FRAMEWORKS } from '$lib/frameworks/registry';
	import { frameworkSettingsStore } from '$lib/stores/frameworkSettings.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	const frameworkId = $derived(uiStore.settingsFrameworkId);

	/** A framework's name, for a message about it. Falls back to the id, which is still more
	 *  use than nothing when a build carries a stored id it does not have a row for. */
	function nameOf(id: string): string {
		return FRAMEWORKS.find((f) => f.id === id)?.name ?? id;
	}

	function toggle(id: string, value: boolean) {
		const result = frameworkSettingsStore.setAvailable(id, value);
		if (result.ok) return;
		// Refused rather than silently ignored: a switch that springs back with no explanation
		// reads as a bug, and the reason is short enough to just say.
		toastStore.error(
			`${nameOf(id)} is needed by ${result.blockedBy.map(nameOf).join(', ')}. Turn that off first.`
		);
	}
</script>

{#if frameworkId}
	{#key frameworkId}
		<FrameworkDetail id={frameworkId} />
	{/key}
{:else}
	<div class="frameworks" data-setting="frameworks">
		<section class="card">
			<p class="intro">
				A framework is a calculation over story state that writes into the prompt: what day it
				is, what a character's cycle is doing, what the model should be reminded of. Switching
				one on here makes it available; each chat then chooses whether to use it.
			</p>
			<div class="rows">
				{#each FRAMEWORKS as framework (framework.id)}
					{@const on = frameworkSettingsStore.isAvailable(framework.id)}
					<div class="framework" class:is-off={!on}>
						<button
							type="button"
							class="row-main"
							onclick={() => (uiStore.settingsFrameworkId = framework.id)}
						>
							<span class="row-orb">
								<Icon name={framework.icon} class="w-4 h-4" strokeWidth={1.75} />
							</span>
							<span class="row-text">
								<span class="row-name">{framework.name}</span>
								<span class="row-summary">{framework.summary}</span>
							</span>
							<Icon name="chevronRight" class="w-4 h-4 row-chev" strokeWidth={2} />
						</button>
						<Toggle
							checked={on}
							onchange={(v) => toggle(framework.id, v)}
							label="Make {framework.name} available"
						/>
					</div>
				{/each}
			</div>
		</section>
	</div>
{/if}

<style>
	.frameworks {
		display: flex;
		flex-direction: column;
	}

	.intro {
		margin: 0 0.35rem 0.75rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.rows {
		display: flex;
		flex-direction: column;
	}

	.rows > .framework + .framework {
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
	}

	.framework {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-right: 0.35rem;
		border-radius: var(--radius-md);
		transition: background-color 120ms ease;
	}

	/* Hover follows the drill button, not the toggle sitting beside it. */
	.framework:has(.row-main:hover) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
	}

	.row-main {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.15rem 0.6rem;
		padding: 0.6rem 0.2rem 0.6rem 0.35rem;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.row-orb {
		grid-column: 1;
		grid-row: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
		color: var(--color-text-secondary);
	}

	.row-text {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.row-name {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 620;
		color: var(--color-text-primary);
	}

	.row-summary {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--color-text-muted);
	}

	/* Off frameworks read as inert without dropping opacity on text. */
	.framework.is-off .row-name,
	.framework.is-off .row-summary {
		color: var(--color-text-muted);
	}

	.framework.is-off .row-orb {
		color: var(--color-text-muted);
		background: transparent;
	}

	.row-main :global(.row-chev) {
		grid-column: 3;
		grid-row: 1;
		color: var(--color-text-muted);
		opacity: 0.65;
	}
</style>
