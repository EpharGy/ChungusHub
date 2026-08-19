<script lang="ts">
	/**
	 * The open book's name in the header, and behind it every book.
	 *
	 * One job: pick the book the page is showing. What you can DO to a book (export, delete,
	 * make, bring) is the actions menu beside it, the same split Preset Controls uses over
	 * its own subject.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { Lorebook } from '$lib/lorebook/types';

	interface Props {
		/** The open book, whose name the header shows. */
		book: Lorebook;
		/** Every book, for the list. */
		books: Lorebook[];
		onSelect: (id: string) => void;
	}

	let { book, books, onSelect }: Props = $props();

	let open = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef && !menuRef.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				// Consume the press so it doesn't cascade into the view/workspace Escape.
				e.stopPropagation();
				open = false;
			}
		};
		document.addEventListener('mousedown', onDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="lb-switcher" bind:this={menuRef}>
	<button
		type="button"
		class="overlay-switch"
		onclick={() => (open = !open)}
		aria-haspopup="menu"
		aria-expanded={open}
		title="Switch lorebook"
	>
		<span class="overlay-subject" class:is-untitled={!book.name}>
			{book.name || 'Untitled lorebook'}
		</span>
		<Icon name="chevronDown" class="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
	</button>
	{#if open}
		<div class="lb-pop" role="menu">
			{#each books as b (b.id)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={b.id === book.id}
					class="lb-book"
					class:is-open={b.id === book.id}
					onclick={() => {
						onSelect(b.id);
						open = false;
					}}
				>
					<span class="lb-book-tick" aria-hidden="true">
						{#if b.id === book.id}<Icon name="check" class="w-3.5 h-3.5" />{/if}
					</span>
					<span class="lb-book-name" class:is-untitled={!b.name}>
						{b.name || 'Untitled lorebook'}
					</span>
					<span class="lb-book-count">{b.entries.length}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* The trigger itself is the shared .overlay-switch recipe. */
	.lb-switcher {
		position: relative;
		min-width: 0;
		max-width: 100%;
	}

	/* Anchored to the switch's own left edge. */
	.lb-pop {
		position: absolute;
		top: calc(100% + 0.375rem);
		left: 0;
		z-index: 45;
		width: min(18rem, calc(100cqw - 1.5rem));
		max-height: min(18rem, 40vh);
		overflow-y: auto;
		padding: 0.25rem;
		background: var(--color-float-bg);
		backdrop-filter: var(--backdrop-blur) saturate(140%);
		-webkit-backdrop-filter: var(--backdrop-blur) saturate(140%);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.lb-book {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.65rem;
		border-radius: var(--radius-md);
		text-align: left;
		cursor: pointer;
		transition: background-color 140ms ease;
	}

	.lb-book:hover {
		background: var(--color-bg-tertiary);
	}

	.lb-book.is-open {
		background: color-mix(in srgb, var(--color-accent) 11%, transparent);
	}

	.lb-book.is-open:hover {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
	}

	/* An always-present gutter, so which book is open reads down one column and the
	   names below it stay on one x. */
	.lb-book-tick {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		width: 0.875rem;
		height: 0.875rem;
		color: var(--color-accent);
	}

	.lb-book-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.lb-book.is-open .lb-book-name {
		color: var(--color-accent);
	}

	.lb-book-name.is-untitled {
		font-style: italic;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.lb-book-count {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
