<script lang="ts">
	/**
	 * One editable block of one framework: its switch, its text, and where it lands.
	 *
	 * It renders from the DECLARATION, so it never learns which framework it is drawing. That
	 * is what lets a framework add a tunable without touching anything here, and what lets a
	 * framework that must not be named in a public file have settings at all.
	 *
	 * Order is deliberately not a control. Everything else about placement is the reader's,
	 * but order is the only coordination frameworks have with each other, and a box for it is
	 * a box for putting a line somewhere it does not belong.
	 */
	import type { ResolvedBlock } from '$lib/frameworks/blocks';
	import Toggle from '$lib/components/ui/Toggle.svelte';

	let {
		block,
		gatherAbsent = false,
		onpatch
	}: {
		block: ResolvedBlock;
		/** True for a reminder line with nothing running to gather it, so the editor can say
		 *  the text is being written and not sent. */
		gatherAbsent?: boolean;
		onpatch: (patch: Record<string, unknown>) => void;
	} = $props();

	const ROLES = [
		{ value: 'system', label: 'System' },
		{ value: 'user', label: 'User' },
		{ value: 'assistant', label: 'Assistant' }
	] as const;
</script>

<section class="card">
	<div class="head">
		<div class="head-text">
			<h4>{block.def.label}</h4>
			<p class="hint">{block.def.hint}</p>
		</div>
		{#if !block.def.alwaysOn}
			<!-- A block that IS the framework has no switch: the framework's own already
			     answers that question, and a second one leaves a state where the thing looks
			     on and does nothing. -->
			<Toggle
				checked={block.on}
				onchange={(v) => onpatch({ on: v })}
				label="Send the {block.def.label.toLowerCase()}"
			/>
		{/if}
	</div>

	{#if block.on && gatherAbsent}
		<p class="warn">
			Nothing is gathering reminders, so this is not being sent. Turn the Reminders framework
			on to use it.
		</p>
	{/if}

	{#if block.def.placeholders?.length}
		<p class="hint">
			Filled in:
			{#each block.def.placeholders as placeholder, i (placeholder)}<code>{placeholder}</code
				>{#if i < block.def.placeholders.length - 1}{', '}{/if}{/each}. Nothing else is: this
			text is injected after macros have already been expanded, so any other
			<code>{'{{'}...{'}}'}</code> reaches the model as written.
		</p>
	{/if}

	<textarea
		rows={block.def.reminder ? 3 : 12}
		spellcheck="false"
		value={block.text}
		oninput={(e) => onpatch({ text: e.currentTarget.value })}
		aria-label={block.def.label}
	></textarea>

	{#if block.missing.length > 0}
		<p class="warn">
			{block.missing.join(' and ')}
			{block.missing.length > 1 ? 'are' : 'is'} gone, so this no longer does the one thing it is
			for.
		</p>
	{/if}

	{#if !block.isDefault}
		<button type="button" class="reset" onclick={() => onpatch({ text: undefined })}>
			Restore the default text
		</button>
	{/if}

	{#if block.def.placement}
		<div class="place">
			<label class="row">
				<span>Where</span>
				<select
					value={block.atDepth ? 'depth' : 'block'}
					onchange={(e) => onpatch({ atDepth: e.currentTarget.value === 'depth' })}
				>
					<option value="block">In the lorebook block</option>
					<option value="depth">In the chat, at a depth</option>
				</select>
			</label>
			{#if block.atDepth}
				<label class="row">
					<span>Depth</span>
					<input
						type="number"
						min="0"
						max="100"
						value={block.depth}
						oninput={(e) => onpatch({ depth: Number(e.currentTarget.value) })}
					/>
				</label>
				<label class="row">
					<span>As</span>
					<select value={block.role} onchange={(e) => onpatch({ role: e.currentTarget.value })}>
						{#each ROLES as role (role.value)}
							<option value={role.value}>{role.label}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>
	{/if}
</section>

<style>
	.head {
		display: flex;
		align-items: start;
		gap: 0.6rem;
	}

	.head-text {
		flex: 1;
		min-width: 0;
	}

	h4 {
		margin: 0 0 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 640;
		color: var(--color-text-primary);
	}

	.hint {
		margin: 0 0 0.5rem;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	textarea {
		width: 100%;
		resize: vertical;
		padding: 0.55rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	.warn {
		margin: 0.5rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-warning);
	}

	.reset {
		margin-top: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: transparent;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	.reset:hover {
		color: var(--color-text-primary);
	}

	.place {
		margin-top: 0.6rem;
		padding-top: 0.5rem;
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
	}

	.row {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr);
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-secondary);
	}

	.row select,
	.row input {
		padding: 0.3rem 0.4rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
	}
</style>
