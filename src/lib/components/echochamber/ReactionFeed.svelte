<script lang="ts">
	import { renderMarkdown } from '$lib/utils/markdown';
	import type { Reaction } from '$lib/echochamber/types';

	// The feed itself: one row per reaction, an avatar disc carrying the handle's initial.
	//
	// Reaction text goes through the app's own renderMarkdown, which sanitizes with
	// DOMPurify. The extension hand-rolled a chain of regex replacements over model output
	// and relied on stripping tags beforehand; using the app's renderer instead means the
	// feed is safe by the same construction as the transcript, and gets the same emphasis,
	// code and quote handling for free.
	interface Props {
		reactions: Reaction[];
		emptyMessage?: string;
	}

	let { reactions, emptyMessage = 'No reactions yet.' }: Props = $props();

	/**
	 * A stable colour per handle, from the name alone.
	 *
	 * Hashing rather than cycling a palette is what makes a regular recognisable: the same
	 * chatter is the same colour every turn and across reloads, with nothing stored.
	 */
	function colorFor(username: string): string {
		let hash = 0;
		for (let i = 0; i < username.length; i++) {
			hash = username.charCodeAt(i) + ((hash << 5) - hash);
		}
		return `hsl(${Math.abs(hash) % 360}, 70%, 62%)`;
	}

	function initial(username: string): string {
		return [...username.trim()][0]?.toUpperCase() ?? '?';
	}
</script>

{#if reactions.length === 0}
	<p class="echo-empty">{emptyMessage}</p>
{:else}
	<ul class="echo-feed">
		{#each reactions as reaction, index (index)}
			{@const color = colorFor(reaction.username)}
			<li class="echo-row">
				<span class="echo-avatar" style:background-color={color} aria-hidden="true">
					{initial(reaction.username)}
				</span>
				<div class="echo-body">
					<span class="echo-name" style:color>{reaction.username}</span>
					<div class="echo-text">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown -->
						{@html renderMarkdown(reaction.text)}
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.echo-feed {
		list-style: none;
		margin: 0;
		padding: 0.5rem 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.echo-row {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
	}

	.echo-avatar {
		flex: 0 0 auto;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 700;
		/* The disc colour is generated, so the text on it is fixed dark for contrast rather
		   than themed: a themed foreground goes invisible on half the hues. */
		color: rgba(0, 0, 0, 0.75);
	}

	.echo-body {
		min-width: 0;
		flex: 1;
	}

	.echo-name {
		display: block;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.echo-text {
		font-size: 0.85rem;
		line-height: 1.45;
		color: var(--color-text-primary);
		overflow-wrap: anywhere;
	}

	/* renderMarkdown wraps in block elements; a reaction is a line, not a document. */
	.echo-text :global(p) {
		margin: 0;
	}
	.echo-text :global(p + p) {
		margin-top: 0.4rem;
	}
	.echo-text :global(pre) {
		white-space: pre-wrap;
		overflow-x: auto;
	}

	.echo-empty {
		margin: 0;
		padding: 1.25rem 1rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--color-text-tertiary);
	}
</style>
