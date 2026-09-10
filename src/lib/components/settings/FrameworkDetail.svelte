<script lang="ts">
	/**
	 * One framework's detail view: what it does, whether this install carries it, and its own
	 * tunables.
	 *
	 * **This is the one place per-framework settings UI is wired**, and it is a short `{#if}`
	 * rather than something rendered off the registry. Engines can render their detail from a
	 * list of prompt fields because every engine's settings ARE a list of prompt templates.
	 * Frameworks' are not alike: one wants a template and a placement, the next wants a
	 * threshold and a tone. A descriptor language general enough to express all of them would
	 * be a worse thing to maintain than one line here per framework.
	 *
	 * A framework with no tunables needs no branch and says so, rather than rendering an empty
	 * card that looks like something failed to load.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import DateFrameworkSettings from './DateFrameworkSettings.svelte';
	import { FRAMEWORKS } from '$lib/frameworks/registry';
	import { DATE_FRAMEWORK_ID } from '$lib/frameworks/date';
	import { frameworkSettingsStore } from '$lib/stores/frameworkSettings.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { id }: { id: string } = $props();

	const framework = $derived(FRAMEWORKS.find((f) => f.id === id));
	const available = $derived(framework ? frameworkSettingsStore.isAvailable(framework.id) : false);

	function nameOf(other: string): string {
		return FRAMEWORKS.find((f) => f.id === other)?.name ?? other;
	}

	function toggle(value: boolean) {
		if (!framework) return;
		const result = frameworkSettingsStore.setAvailable(framework.id, value);
		if (result.ok) return;
		toastStore.error(
			`${framework.name} is needed by ${result.blockedBy.map(nameOf).join(', ')}. Turn that off first.`
		);
	}
</script>

<div class="detail" data-setting="frameworks">
	<button type="button" class="back" onclick={() => (uiStore.settingsFrameworkId = null)}>
		<Icon name="chevronLeft" class="w-4 h-4" strokeWidth={2} />
		<span>Frameworks</span>
	</button>

	{#if !framework}
		<section class="card">
			<p class="note">
				This build does not carry a framework called <code>{id}</code>. Its settings are kept,
				so they come back if it returns.
			</p>
		</section>
	{:else}
		<section class="card head">
			<span class="orb"><Icon name={framework.icon} class="w-5 h-5" strokeWidth={1.75} /></span>
			<div class="head-text">
				<h3>{framework.name}</h3>
				<p>{framework.description}</p>
				{#if framework.requires?.length}
					<p class="requires">
						Needs {framework.requires.map(nameOf).join(', ')}, which is turned on with it.
					</p>
				{/if}
			</div>
			<Toggle checked={available} onchange={toggle} label="Make {framework.name} available" />
		</section>

		{#if !available}
			<p class="note">
				Off, so nothing below reaches a prompt. The settings are kept and take effect again
				when it is switched back on.
			</p>
		{/if}

		{#if framework.id === DATE_FRAMEWORK_ID}
			<DateFrameworkSettings />
		{:else}
			<p class="note">This framework has nothing to tune.</p>
		{/if}
	{/if}
</div>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		align-self: flex-start;
		padding: 0.2rem 0.35rem 0.2rem 0.1rem;
		border: 0;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.back:hover {
		color: var(--color-text-primary);
	}

	.head {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.75rem;
	}

	.orb {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
		color: var(--color-text-secondary);
	}

	.head-text {
		min-width: 0;
	}

	.head-text h3 {
		margin: 0.15rem 0 0.25rem;
		font-family: var(--font-ui);
		font-size: 0.92rem;
		font-weight: 640;
		color: var(--color-text-primary);
	}

	.head-text p {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.requires {
		margin-top: 0.3rem !important;
		color: var(--color-text-secondary) !important;
	}

	.note {
		margin: 0 0.35rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}
</style>
