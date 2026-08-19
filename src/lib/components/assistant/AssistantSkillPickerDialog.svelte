<script lang="ts">
	/**
	 * Which skills leave in an export file, and which come in from an import file or from
	 * the skills the app ships. All three ask the same question, so they share this dialog:
	 * the caller hands it the rows and the direction, and it answers with the keys left ticked.
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		open: boolean;
		mode: 'export' | 'import' | 'defaults';
		/** Stable while the dialog is open: a fresh array would reset the ticks under the user.
		 *  A row wearing a `tag` starts UNTICKED: the tag exists to say you probably have this
		 *  one already, so nothing is duplicated by a reflex click on the confirm button. */
		rows: { key: string; name: string; description: string; tag?: string }[];
		onConfirm: (keys: string[]) => void;
		onCancel: () => void;
	}

	let { open, mode, rows, onConfirm, onCancel }: Props = $props();

	let exporting = $derived(mode === 'export');
	let note = $derived(
		mode === 'defaults'
			? 'The skills ChungusHub ships with, as they were shipped. Whatever you pick joins your list as a new skill; nothing you already have is touched.'
			: mode === 'import'
				? 'Whatever you pick joins your list as a new skill; nothing you already have is touched.'
				: ''
	);

	let selected = $state<string[]>([]);

	// Every open starts from the useful default: everything worth taking is ticked, and
	// All / None is one click from any other answer.
	$effect(() => {
		if (open) selected = rows.filter((r) => !r.tag).map((r) => r.key);
	});

	function toggle(key: string): void {
		selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
	}
</script>

<Dialog {open} onClose={onCancel} title={mode === 'export' ? 'Export skills' : mode === 'import' ? 'Import skills' : 'Default skills'} size="md">
	<div class="sp-body">
		{#if note}
			<p class="sp-note">{note}</p>
		{/if}

		<div class="sp-head">
			<span class="sp-count">{selected.length} of {rows.length} selected</span>
			<div class="sp-bulk">
				<button type="button" class="sp-bulk-btn" onclick={() => (selected = rows.map((r) => r.key))} disabled={selected.length === rows.length}>All</button>
				<button type="button" class="sp-bulk-btn" onclick={() => (selected = [])} disabled={selected.length === 0}>None</button>
			</div>
		</div>

		<div class="sp-list">
			{#each rows as row (row.key)}
				<label class="sp-row" class:is-active={selected.includes(row.key)}>
					<input type="checkbox" checked={selected.includes(row.key)} onchange={() => toggle(row.key)} />
					<span class="sp-row-body">
						<span class="sp-row-name">
							{row.name}
							{#if row.tag}<span class="sp-row-tag">{row.tag}</span>{/if}
						</span>
						<span class="sp-row-desc">{row.description}</span>
					</span>
				</label>
			{/each}
		</div>

		<div class="sp-actions">
			<Button variant="ghost" onclick={onCancel}>Cancel</Button>
			<Button variant="primary" onclick={() => onConfirm(selected)} disabled={selected.length === 0}>
				<Icon name={exporting ? 'download' : 'plus'} class="w-4 h-4" />
				{exporting ? 'Export' : 'Add'}
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.sp-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.sp-note {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.sp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.sp-count {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.sp-bulk {
		display: flex;
		gap: 0.3rem;
	}

	.sp-bulk-btn {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: color 140ms ease, border-color 140ms ease;
	}

	.sp-bulk-btn:hover:not(:disabled) {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.sp-bulk-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.sp-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 22rem;
		overflow-y: auto;
	}

	.sp-row {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 35%, transparent);
		cursor: pointer;
		transition: border-color 140ms ease, background-color 140ms ease;
	}

	.sp-row:hover {
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.sp-row.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.sp-row input {
		margin-top: 0.2rem;
		accent-color: var(--color-accent);
	}

	.sp-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.sp-row-name {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.sp-row-tag {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.05rem 0.35rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-text-muted) 18%, transparent);
		color: var(--color-text-muted);
	}

	.sp-row-desc {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.sp-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		padding-top: 0.2rem;
	}
</style>
