<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { BRANCH_COLORS } from '$lib/utils/branch-labels';
	import type { StoryMapNode } from '$lib/utils/story-map-layout';
	import type { BranchLabel } from '$lib/types/chat';

	interface Props {
		node: StoryMapNode;
		/** Display name for the role chip (persona/character resolved by the parent). */
		roleName: string;
		/** Pre-formatted creation time. */
		timeText: string;
		/** Self-ref-expanded content. This panel reads a turn, it never rewrites one. */
		previewText: string;
		/** This turn is folded into chat memory (recalled as a summary, not sent verbatim). */
		archived: boolean;
		onClose: () => void;
		onJump: () => void;
		onToggleCanon: () => void;
		onStartCompare: () => void;
		onSaveLabel: (label: BranchLabel | null) => void;
	}

	let {
		node,
		roleName,
		timeText,
		previewText,
		archived,
		onClose,
		onJump,
		onToggleCanon,
		onStartCompare,
		onSaveLabel
	}: Props = $props();

	// ===== Branch label draft =====
	let labelName = $state('');
	let labelColor = $state<string>(BRANCH_COLORS[0].key);

	// Re-seed the draft only when the selection moves to a DIFFERENT turn. The node prop's
	// identity churns on every graph refresh (sync, stream landing), and wiping an
	// in-progress name for that would eat the user's typing.
	let seededForId = '';
	$effect(() => {
		if (node.id === seededForId) return;
		seededForId = node.id;
		labelName = node.label?.name ?? '';
		labelColor = node.label?.color ?? BRANCH_COLORS[0].key;
	});

	function saveLabel() {
		const name = labelName.trim();
		onSaveLabel(name ? { name, color: labelColor } : null);
	}

	function removeLabel() {
		labelName = '';
		onSaveLabel(null);
	}
</script>

<aside class="insp surface-float panel-scroll" role="region" aria-label="Turn details">
	<header class="insp-head">
		<span class="insp-role insp-role--{node.role}">{roleName}</span>
		<span class="insp-turn">Turn {node.depth + 1}</span>
		{#if node.isActiveLeaf}<span class="insp-tag insp-tag--active">You are here</span>{/if}
		{#if node.isCanonLeaf}<span class="insp-tag insp-tag--canon">Canon</span>{/if}
		{#if archived}<span class="insp-tag insp-tag--memory">In memory</span>{/if}
		<button type="button" class="insp-x" aria-label="Close details" onclick={onClose}>
			<Icon name="close" class="w-4 h-4" />
		</button>
	</header>

	<p class="insp-preview">{previewText}</p>

	<div class="insp-meta">
		<span class="insp-chip">{timeText}</span>
		{#if node.siblingCount > 1}<span class="insp-chip">Variant {node.siblingIndex + 1} of {node.siblingCount}</span>{/if}
		{#if node.attachmentCount > 0}
			<span class="insp-chip">{node.attachmentCount} image{node.attachmentCount === 1 ? '' : 's'}</span>
		{/if}
		{#if node.childCount > 1}<span class="insp-chip">{node.childCount} branches below</span>{/if}
		{#if node.model}<span class="insp-chip insp-chip--trunc" title={node.model}>{node.model}</span>{/if}
		{#if node.tokensCompletion}<span class="insp-chip">{node.tokensCompletion.toLocaleString()} tokens</span>{/if}
	</div>

	<div class="insp-actions">
		<button type="button" class="insp-btn insp-btn--primary" onclick={onJump}>
			<Icon name="chat" class="w-4 h-4" /> Open in chat
		</button>
		<div class="insp-action-row">
			<button
				type="button"
				class="insp-btn insp-btn--half"
				class:insp-btn--canon={node.isCanonLeaf}
				onclick={onToggleCanon}
				title={node.isCanonLeaf ? 'Clear the canon mark' : 'Bless this timeline as the real story'}
			>
				<Icon name="crown" class="w-4 h-4" /> {node.isCanonLeaf ? 'Unset canon' : 'Make canon'}
			</button>
			<button
				type="button"
				class="insp-btn insp-btn--half"
				onclick={onStartCompare}
				title="Compare this branch against another"
			>
				<Icon name="columns" class="w-4 h-4" /> Compare…
			</button>
		</div>
	</div>

	<div class="insp-label">
		<label class="insp-label-title" for="branch-name">Branch name</label>
		<input
			id="branch-name"
			class="insp-input"
			type="text"
			maxlength="40"
			placeholder="e.g. Dark ending"
			bind:value={labelName}
			onkeydown={(e) => e.key === 'Enter' && saveLabel()}
		/>
		<div class="insp-swatches" aria-label="Branch color">
			{#each BRANCH_COLORS as c (c.key)}
				<button
					type="button"
					class="swatch"
					class:is-on={labelColor === c.key}
					style="--sw: {c.hex};"
					title={c.label}
					aria-label={c.label}
					aria-pressed={labelColor === c.key}
					onclick={() => (labelColor = c.key)}
				></button>
			{/each}
		</div>
		<div class="insp-label-actions">
			<button type="button" class="insp-btn insp-btn--primary" onclick={saveLabel}>
				<Icon name="check" class="w-4 h-4" /> Save
			</button>
			{#if node.label}
				<button type="button" class="insp-btn insp-btn--danger" onclick={removeLabel}>
					<Icon name="trash" class="w-4 h-4" /> Remove
				</button>
			{/if}
		</div>
	</div>
</aside>

<style>
	.insp {
		width: 100%;
		max-height: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.9rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	.insp-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	/* Tinted rather than filled, and keyed to one per-role colour: a solid pill needs a text
	   colour that reads on it, which no single value gives across every theme and every role
	   hue. This one is legible whatever `--rc` turns out to be, and matches the tags beside
	   it in the same header row. */
	.insp-role {
		max-width: 11rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.14rem 0.5rem;
		border-radius: var(--radius-full);
		color: var(--rc);
		background: color-mix(in srgb, var(--rc) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--rc) 38%, transparent);
	}

	.insp-role--user {
		--rc: var(--color-accent);
	}

	.insp-role--assistant {
		--rc: var(--color-text-secondary);
	}

	.insp-role--system {
		--rc: var(--color-text-muted);
	}

	.insp-turn {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.insp-tag {
		font-family: var(--font-ui);
		font-size: 0.64rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
	}

	.insp-tag--active {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 32%, transparent);
	}

	.insp-tag--canon {
		color: var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 18%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-warning) 44%, transparent);
	}

	.insp-tag--memory {
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		border: 1px solid var(--color-border-subtle);
	}

	.insp-x {
		margin-left: auto;
		width: 1.9rem;
		height: 1.9rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.insp-x:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	.insp-preview {
		margin: 0;
		flex-shrink: 1;
		min-height: 3.2rem;
		max-height: 13rem;
		overflow-y: auto;
		font-family: var(--font-ui);
		font-size: 0.84rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
		padding: 0.55rem 0.65rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-primary) 55%, transparent);
		border: 1px solid var(--color-border-subtle);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.insp-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.insp-chip {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		padding: 0.14rem 0.5rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		border: 1px solid var(--color-border-subtle);
	}

	.insp-chip--trunc {
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.insp-actions {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.insp-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		justify-content: flex-start;
		min-height: 2.25rem;
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 55%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.insp-btn:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		border-color: color-mix(in srgb, var(--color-border) 70%, transparent);
	}

	.insp-btn:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-accent) 70%, transparent);
		outline-offset: 1px;
	}

	.insp-btn--primary {
		color: #fff;
		background: var(--color-accent);
		border-color: transparent;
	}

	.insp-btn--primary:hover {
		color: #fff;
		background: var(--color-accent-hover);
	}

	.insp-btn--danger {
		color: var(--color-error);
		border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
	}

	.insp-btn--danger:hover {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.insp-btn--canon {
		color: var(--color-warning);
		border-color: color-mix(in srgb, var(--color-warning) 44%, transparent);
	}

	.insp-action-row {
		display: flex;
		gap: 0.4rem;
	}

	/* The labels are short, but they must never wrap into two lines inside a button that
	   also carries an icon. */
	.insp-btn--half {
		flex: 1;
		min-width: 0;
		justify-content: center;
		white-space: nowrap;
	}

	.insp-label {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding-top: 0.7rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.insp-label-title {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.insp-input {
		height: 2.25rem;
		padding: 0 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-input-bg);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.84rem;
	}

	.insp-input:focus {
		outline: 0;
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-muted) 60%, transparent);
	}

	.insp-swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.swatch {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-full);
		border: 2px solid transparent;
		background: var(--sw);
		cursor: pointer;
		padding: 0;
		box-shadow: inset 0 0 0 2px var(--color-bg-primary);
		transition: transform 120ms ease, box-shadow 120ms ease;
	}

	.swatch:hover {
		transform: scale(1.1);
	}

	.swatch:focus-visible {
		outline: 2px solid var(--color-text-primary);
		outline-offset: 2px;
	}

	.swatch.is-on {
		border-color: var(--color-text-primary);
	}

	.insp-label-actions {
		display: flex;
		gap: 0.4rem;
	}

	.insp-label-actions .insp-btn {
		flex: 1;
		justify-content: center;
	}
</style>
