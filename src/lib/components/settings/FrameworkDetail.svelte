<script lang="ts">
	/**
	 * One framework's detail view: what it does, whether this install carries it, and its own
	 * tunables.
	 *
	 * **It knows no framework by name.** An earlier version branched on the framework id, which
	 * worked for exactly one framework and then stopped: a public file cannot carry a branch
	 * for a framework whose name must not appear in a public file. Frameworks declare their
	 * editable blocks and their marker references instead and this renders them, so adding a
	 * tunable, or documenting a marker's syntax, touches nothing here.
	 *
	 * A framework with no blocks says so rather than rendering an empty card that looks like
	 * something failed to load.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import FrameworkBlockEditor from './FrameworkBlockEditor.svelte';
	import { FRAMEWORKS } from '$lib/frameworks/registry';
	import { resolveBlocks } from '$lib/frameworks/blocks';
	import { frameworkSettingsStore } from '$lib/stores/frameworkSettings.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { id }: { id: string } = $props();

	const framework = $derived(FRAMEWORKS.find((f) => f.id === id));
	const available = $derived(framework ? frameworkSettingsStore.isAvailable(framework.id) : false);

	const blocks = $derived(
		framework ? resolveBlocks(framework.blocks, frameworkSettingsStore.configFor(framework.id)) : []
	);

	/** True when a reminder line has nothing running to gather it, so its editor can say the
	 *  text is being written and not sent rather than leaving that to be discovered.
	 *
	 *  Structurally false now: the shelf is `alwaysOn`, so `isAvailable` answers true for it
	 *  whatever is stored. Kept rather than deleted because it is a statement about the
	 *  REGISTRY, not about a switch, and a build carrying no gatherer at all is still a build
	 *  this can be right about. */
	const gatherAbsent = $derived(
		!FRAMEWORKS.some(
			(f) =>
				frameworkSettingsStore.isAvailable(f.id) && f.blocks?.some((b) => b.gathersReminders)
		)
	);

	function patchBlock(slot: string, patch: Record<string, unknown>) {
		if (!framework) return;
		const config = frameworkSettingsStore.configFor(framework.id);
		const current =
			config && typeof config === 'object' && !Array.isArray(config)
				? ((config as Record<string, unknown>).blocks ?? {})
				: {};
		const existing = (current as Record<string, unknown>)[slot];
		const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
		frameworkSettingsStore.patchConfig(framework.id, {
			blocks: { ...(current as Record<string, unknown>), [slot]: { ...base, ...patch } }
		});
	}

	function nameOf(other: string): string {
		return FRAMEWORKS.find((f) => f.id === other)?.name ?? other;
	}

	function toggle(value: boolean) {
		if (!framework) return;
		const result = frameworkSettingsStore.setAvailable(framework.id, value);
		if (result.ok) return;
		// No blockers named means the framework has no switch, which this page does not render
		// one for. The store is the authority either way, and a message it cannot explain is
		// worse than one it can.
		toastStore.error(
			result.blockedBy.length === 0
				? `${framework.name} is always on.`
				: `${framework.name} is needed by ${result.blockedBy.map(nameOf).join(', ')}. Turn that off first.`
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
			<!-- Same rule the overview row follows: a framework with no switch says so rather
			     than showing one that cannot move. This page is the second place the app-wide
			     switch appears, so leaving it here would have been the one toggle that still
			     claimed the framework could be turned off. -->
			{#if framework.alwaysOn}
				<span class="head-fixed">Always on</span>
			{:else}
				<Toggle checked={available} onchange={toggle} label="Make {framework.name} available" />
			{/if}
		</section>

		{#each framework.reference ?? [] as ref (ref.title)}
			<section class="card reference">
				<details>
					<summary>
						<Icon name="chevronDown" class="w-3.5 h-3.5 chev" strokeWidth={2} />
						<span>{ref.title}</span>
					</summary>
					<div class="ref-body">
						<!-- Selectable rather than a copy button, deliberately: it is one short line,
						     and a button would be a second way to fail on a page that has none. -->
						<pre class="snippet">{ref.snippet}</pre>
						<p class="ref-hint">{ref.hint}</p>
						{#if ref.values?.length}
							<dl class="values">
								{#each ref.values as value (value.value)}
									<div class="value">
										<dt>
											<code>{value.value}</code>
											<span>{value.label}</span>
										</dt>
										<dd>{value.detail}</dd>
									</div>
								{/each}
							</dl>
						{/if}
					</div>
				</details>
			</section>
		{/each}

		{#if !available}
			<p class="note">
				Off, so nothing below reaches a prompt. The settings are kept and take effect again
				when it is switched back on.
			</p>
		{/if}

		{#if blocks.length === 0}
			<p class="note">This framework has nothing to tune.</p>
		{:else}
			{#each blocks as block (block.def.slot)}
				<FrameworkBlockEditor
					{block}
					gatherAbsent={block.def.reminder ? gatherAbsent : false}
					onpatch={(patch) => patchBlock(block.def.slot, patch)}
				/>
			{/each}
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

	/* Sits in the toggle's column so the head still reads as one row. */
	.head-fixed {
		align-self: center;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		white-space: nowrap;
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

	/* A marker reference: closed by default, because it is read once while writing a marker
	   and never again, and a page that opens with a wall of syntax buries its own controls.
	   The card supplies the surface; only the disclosure is styled here. */
	.reference {
		padding: 0.6rem;
	}

	.reference summary {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.15rem 0.1rem;
		cursor: pointer;
		list-style: none;
		user-select: none;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 620;
		color: var(--color-text-secondary);
	}

	.reference summary::-webkit-details-marker {
		display: none;
	}

	.reference :global(.chev) {
		flex: none;
		color: var(--color-text-muted);
		transform: rotate(-90deg);
		transition: transform 0.15s ease;
	}

	.reference details[open] :global(.chev) {
		transform: rotate(0deg);
	}

	.ref-body {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.6rem 0.1rem 0.1rem;
	}

	/* There is no copy button, so `user-select` here is the feature rather than a default
	   being restated: the summary above sets `none` and a nested element would inherit it. */
	.snippet {
		margin: 0;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		line-height: 1.6;
		color: var(--color-text-primary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
		cursor: text;
	}

	.ref-hint {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.values {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin: 0;
	}

	.value dt {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.value dt code {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--color-accent);
		user-select: text;
	}

	.value dt span {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.value dd {
		margin: 0.1rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}
</style>
