<script lang="ts">
	/**
	 * Capabilities: which families of tools the assistant may reach.
	 *
	 * This is a cost control as much as a consent one: every enabled family's schemas ride
	 * the front of EVERY request, so the page prices each switch in tokens (measured by the
	 * same estimator the server's context budget uses, never a number typed in here). The
	 * three presets are shortcuts, not a stored field: the enabled set is the only thing
	 * saved, and whichever preset it happens to equal lights up.
	 *
	 * Asymmetry worth knowing while reading this: switching a family OFF bites every open
	 * session at once, while switching one ON reaches an open session only when the user
	 * applies the settings to it: its tool list is frozen, so those tools genuinely are not
	 * there yet. The panel's Apply notice is what says so.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { db } from '$lib/services/database';
	import { registerSettingsReload } from '$lib/services/syncedSetting';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toggleRow } from '$lib/actions/toggleRow';
	import {
		CAPABILITIES_SETTING,
		fetchCapabilityCatalog,
		parseEnabledGroups,
		presetFor,
		type CapabilityCatalog
	} from '$lib/services/assistantCapabilities';

	let catalog = $state<CapabilityCatalog | null>(null);
	let enabled = $state<string[]>([]);
	let loaded = $state(false);

	let activePreset = $derived(catalog ? presetFor(enabled, catalog) : null);
	let totalTokens = $derived(
		catalog ? catalog.groups.filter((g) => enabled.includes(g.id)).reduce((n, g) => n + g.tokens, 0) : 0
	);

	async function load(): Promise<void> {
		try {
			catalog ??= await fetchCapabilityCatalog();
			enabled = parseEnabledGroups(await db.getSetting(CAPABILITIES_SETTING), catalog);
			loaded = true;
		} catch (e) {
			toastStore.failed('load the assistant capabilities', e);
		}
	}

	async function save(next: string[]): Promise<void> {
		const previous = enabled;
		enabled = next;
		try {
			await db.setSetting(CAPABILITIES_SETTING, JSON.stringify(next));
		} catch (e) {
			enabled = previous;
			toastStore.failed('save the capabilities', e);
		}
	}

	function toggleGroup(id: string, on: boolean): void {
		if (!catalog) return;
		const wanted = new Set(enabled);
		if (on) wanted.add(id);
		else wanted.delete(id);
		void save(catalog.groups.filter((g) => g.alwaysOn || wanted.has(g.id)).map((g) => g.id));
	}

	function applyPreset(id: string): void {
		const preset = catalog?.presets.find((p) => p.id === id);
		if (preset) void save([...preset.groups]);
	}

	onMount(() => {
		void load();
		// The chosen set is an ordinary settings row, so another device changing it must
		// reach this page: a stale list left open here would be re-saved over the newer one.
		return registerSettingsReload(load);
	});
</script>

<div class="cap-presets" role="group" aria-label="Capability presets">
	{#each catalog?.presets ?? [] as preset (preset.id)}
		<button
			type="button"
			class="cap-preset"
			class:cap-preset--active={activePreset === preset.id}
			onclick={() => applyPreset(preset.id)}
			disabled={!loaded}
			title={preset.describe}
		>
			{preset.label}
		</button>
	{/each}
	<span class="cap-total">
		{#if loaded}~{totalTokens.toLocaleString()} tokens{:else}…{/if}
	</span>
</div>

<div class="cap-list">
	{#each catalog?.groups ?? [] as group (group.id)}
		<div class="cap-card" use:toggleRow>
			<div class="cap-text">
				<span class="cap-name">{group.label}</span>
				{#if group.experimental}
					<span class="cap-experimental">Experimental</span>
				{/if}
				<InfoTip text={`${group.describe} Tools: ${group.tools.join(', ')}.`} />
				<span class="cap-cost">~{group.tokens.toLocaleString()}</span>
			</div>
			{#if group.alwaysOn}
				<span class="cap-always" title="Core is what the assistant is: reading your workspace.">
					<Icon name="lock" class="w-3 h-3" />
					Always on
				</span>
			{:else}
				<Toggle
					checked={enabled.includes(group.id)}
					onchange={(v) => toggleGroup(group.id, v)}
					disabled={!loaded}
					label={group.label}
				/>
			{/if}
		</div>
	{/each}
</div>

<style>
	.cap-presets {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
	}

	.cap-preset {
		padding: 0.25rem 0.6rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		cursor: pointer;
		transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
	}

	.cap-preset:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		color: var(--color-text-primary);
	}

	.cap-preset--active {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.cap-preset:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* The running total sits with the presets: the whole point of the page is that these
	   switches are a context bill, and the bill should be readable without adding up the
	   numbers by hand. */
	.cap-total {
		margin-left: auto;
		font-family: var(--font-mono, monospace);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	.cap-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.cap-card {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 86%, transparent);
	}

	.cap-text {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.cap-name {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.cap-cost {
		margin-left: auto;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.cap-experimental {
		flex-shrink: 0;
		padding: 0.08rem 0.4rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
		background: color-mix(in srgb, var(--color-warning) 10%, transparent);
		color: var(--color-warning);
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.cap-always {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	@container (max-width: 28rem) {
		/* The control drops under the text rather than squeezing it (the perm-card recipe). */
		.cap-card {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}

		.cap-card > :last-child {
			justify-self: start;
		}
	}
</style>
