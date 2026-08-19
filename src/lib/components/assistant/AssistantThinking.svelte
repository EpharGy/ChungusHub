<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	let { text, live = false }: { text: string; live?: boolean } = $props();

	let expanded = $state(false);
</script>

<div class="thinking" class:thinking--live={live}>
	<button type="button" class="thinking-head" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
		<Icon name={expanded ? 'chevronDown' : 'chevronRight'} class="w-3.5 h-3.5 shrink-0" />
		<!-- No live dot: the activity line at the foot of the turn owns liveness, and a second
		     pulse beside this title would be the same word twice. The title still says which
		     block is currently filling. -->
		<span class="thinking-title">{live ? 'Thinking…' : 'Thought process'}</span>
	</button>
	{#if expanded}
		<div class="thinking-body">{text}</div>
	{/if}
</div>

<style>
	.thinking {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.thinking-head {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		align-self: flex-start;
		/* Same left inset as an action row's icon, so every glyph in a turn shares one rail. */
		padding: 0.15rem 0.45rem;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-style: italic;
		cursor: pointer;
	}

	.thinking-head:hover {
		color: var(--color-text-secondary);
	}

	.thinking-title {
		white-space: nowrap;
	}

	.thinking-body {
		white-space: pre-wrap;
		word-break: break-word;
		padding: 0.4rem 0.55rem;
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		margin-left: 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}
</style>
