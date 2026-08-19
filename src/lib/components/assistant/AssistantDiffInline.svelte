<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { AssistantToolResult } from '$lib/services/transport';
	import { richDiff, condenseLines, diffLineCounts, leadWithChange } from '$lib/utils/diff';

	type IconName = ComponentProps<typeof Icon>['name'];

	let {
		action,
		icon = 'check',
		navigable = false,
		onNavigate,
		onExpand
	}: {
		action: AssistantToolResult;
		icon?: IconName;
		navigable?: boolean;
		onNavigate?: () => void;
		onExpand: () => void;
	} = $props();

	let full = $derived(action.diff ? richDiff(action.diff.before, action.diff.after) : []);
	let lines = $derived(leadWithChange(condenseLines(full)));
	let counts = $derived(diffLineCounts(full));

	// The body is height-capped; if the diff is taller (many lines or long
	// paragraphs) we surface "Click to expand" to open the full, scrollable popup.
	let bodyEl = $state<HTMLElement | null>(null);
	let overflowing = $state(false);
	$effect(() => {
		void lines;
		if (bodyEl) overflowing = bodyEl.scrollHeight - bodyEl.clientHeight > 4;
	});
</script>

<div class="idiff">
	<div class="idiff-headrow">
		<button
			type="button"
			class="idiff-head"
			onclick={() => (navigable && onNavigate ? onNavigate() : onExpand())}
			title={navigable ? 'Go to this in the app' : 'Open full diff'}
		>
			<Icon name={icon} class="w-3.5 h-3.5 shrink-0" />
			<span class="idiff-label">{action.label}</span>
			<span class="idiff-stat"><span class="idiff-add">+{counts.add}</span> <span class="idiff-del">−{counts.del}</span></span>
			{#if navigable}<Icon name="arrowRight" class="w-3 h-3 shrink-0 idiff-go" />{/if}
		</button>
	</div>
	<button type="button" class="idiff-body" class:idiff-body--clip={overflowing} onclick={onExpand} title="Expand diff" bind:this={bodyEl}>
		{#each lines as line, i (i)}
			{#if line.type === 'gap'}
				<div class="idiff-gap">⋯</div>
			{:else if line.type === 'same'}
				<div class="idiff-row idiff-row--same">
					<span class="idiff-sign"></span>
					<span class="idiff-text">{line.text || ' '}</span>
				</div>
			{:else}
				<div class="idiff-row idiff-row--{line.type}">
					<span class="idiff-sign">{line.type === 'add' ? '+' : '−'}</span>
					<span class="idiff-text"
						>{#each line.segs as seg, s (s)}{#if seg.changed}<mark class="idiff-mark idiff-mark--{line.type}">{seg.text}</mark
							>{:else}{seg.text}{/if}{/each}</span
					>
				</div>
			{/if}
		{/each}
	</button>
</div>

<style>
	.idiff {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
	}

	.idiff-headrow {
		display: flex;
		align-items: stretch;
	}

	.idiff-head {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.5rem;
		border: none;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
		text-align: left;
	}

	.idiff-head:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.idiff-head :global(svg) {
		color: var(--color-success);
	}

	.idiff-head :global(svg.idiff-go) {
		color: var(--color-text-muted);
	}

	.idiff-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.idiff-stat {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
	}

	.idiff-add {
		color: var(--color-success);
	}

	.idiff-del {
		color: var(--color-error);
	}

	.idiff-body {
		display: block;
		width: 100%;
		max-height: 9rem;
		overflow: hidden;
		padding: 0.15rem 0;
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		background: transparent;
		text-align: left;
		cursor: pointer;
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.5;
	}

	.idiff-body--clip {
		-webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
		mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
	}

	.idiff-row {
		display: flex;
		gap: 0.35rem;
		padding: 0 0.5rem;
	}

	.idiff-row--add {
		background: color-mix(in srgb, var(--color-success) 12%, transparent);
	}

	.idiff-row--del {
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.idiff-sign {
		flex-shrink: 0;
		width: 0.7rem;
		text-align: center;
		user-select: none;
		color: var(--color-text-muted);
	}

	.idiff-row--add .idiff-sign {
		color: var(--color-success);
	}

	.idiff-row--del .idiff-sign {
		color: var(--color-error);
	}

	.idiff-text {
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--color-text-primary);
	}

	/* Carried-over words in a changed line stay calm; the changed words below pop. */
	.idiff-row--add .idiff-text,
	.idiff-row--del .idiff-text {
		color: color-mix(in srgb, var(--color-text-primary) 62%, transparent);
	}

	/* The actual edited words: the thing the user is hunting for at a glance. */
	.idiff-mark {
		border-radius: 0.25rem;
		padding: 0 0.1rem;
		color: var(--color-text-primary);
	}

	.idiff-mark--add {
		background: color-mix(in srgb, var(--color-success) 36%, transparent);
		font-weight: 600;
	}

	.idiff-mark--del {
		background: color-mix(in srgb, var(--color-error) 32%, transparent);
	}

	.idiff-gap {
		padding: 0 0.5rem;
		color: var(--color-text-muted);
		user-select: none;
	}

	.idiff-body:hover .idiff-row--add {
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
	}

	.idiff-body:hover .idiff-row--del {
		background: color-mix(in srgb, var(--color-error) 18%, transparent);
	}
</style>
