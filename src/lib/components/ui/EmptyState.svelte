<script lang="ts">
	/**
	 * The one shape of "there is nothing here yet": the `.empty-orb` disc with its
	 * muted glyph, a heading, one line of copy, and the action that ends the
	 * emptiness. Every browse panel, overlay and settings page renders this rather
	 * than re-spelling the stack, because an empty screen is the one screen a
	 * reader meets before they know how the app works, and three of them drawn at
	 * three sizes reads as three unfinished features.
	 *
	 * Two sizes and no more. `md` is a whole panel with nothing in it (the Library
	 * with no characters, the Lorebook with no books) and carries the heading. `sm`
	 * is a state INSIDE a working panel: a filter that matched nothing, a sub-view
	 * waiting on a chat. It is smaller because the panel around it is already
	 * saying what surface this is.
	 *
	 * **The action is the point.** An empty state that only describes the emptiness
	 * leaves the reader to go find the button themselves, which is the one thing
	 * they cannot do yet. Pass `actions` unless the emptiness genuinely has no
	 * remedy on this screen (no chat is open, an engine is off elsewhere).
	 */
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		icon: IconName;
		/** Sentence case. Omitted on `sm` states whose one line says it all. */
		title?: string;
		size?: 'sm' | 'md';
		/** The single explanatory line. */
		children?: Snippet;
		/** Buttons that end the emptiness. */
		actions?: Snippet;
	}

	let { icon, title, size = 'md', children, actions }: Props = $props();
</script>

<div class="empty-state empty-state--{size}">
	<div class="empty-orb empty-state-orb">
		<Icon name={icon} class="empty-state-glyph" strokeWidth={1.5} />
	</div>
	{#if title}
		<h3 class="empty-state-title">{title}</h3>
	{/if}
	{#if children}
		<p class="empty-state-copy">{@render children()}</p>
	{/if}
	{#if actions}
		<div class="empty-state-actions">{@render actions()}</div>
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		/* No height of its own: the panel that hosts it decides whether this fills
		   the body or sits in a card. */
		padding: 1rem;
	}

	.empty-state-orb {
		margin-bottom: 0.9rem;
	}

	.empty-state--md .empty-state-orb {
		width: 5rem;
		height: 5rem;
	}

	.empty-state--sm .empty-state-orb {
		width: 4rem;
		height: 4rem;
	}

	.empty-state :global(.empty-state-glyph) {
		color: var(--color-text-muted);
	}

	.empty-state--md :global(.empty-state-glyph) {
		width: 2.5rem;
		height: 2.5rem;
	}

	.empty-state--sm :global(.empty-state-glyph) {
		width: 2rem;
		height: 2rem;
	}

	.empty-state-title {
		margin: 0 0 0.5rem;
		font-family: var(--font-ui);
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.empty-state--md .empty-state-title {
		font-size: 1.125rem;
	}

	.empty-state--sm .empty-state-title {
		font-size: 1rem;
	}

	/* Capped at a comfortable measure rather than the panel's width: one line of
	   explanation running the full width of a wide overlay is a line nobody
	   finishes. */
	.empty-state-copy {
		margin: 0;
		max-width: 26rem;
		font-family: var(--font-ui);
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.empty-state-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
</style>
