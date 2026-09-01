<script lang="ts">
	/**
	 * The popped-out image: one picture in a floating, dockable window that stays on screen
	 * while you work somewhere else in the app.
	 *
	 * Mounted once at the shell's top level and driven by `imagePopoutStore`, never by the
	 * grid that opened it. See the store for why that is load-bearing rather than tidy.
	 *
	 * Paging is by the two header buttons and nothing else. A window-level arrow-key handler
	 * would have to know whether this window or the composer had the reader's attention, and
	 * getting that wrong steals the arrow keys from typing. Two buttons cannot be wrong.
	 */
	import Icon from './Icon.svelte';
	import FloatingWindow from './FloatingWindow.svelte';
	import { imagePopoutStore } from '$lib/stores/imagePopout.svelte';
	import { fileUrl } from '$lib/services/transport';

	let path = $derived(imagePopoutStore.images[imagePopoutStore.index] ?? null);
	let src = $derived(path ? fileUrl(path) : '');
	let filename = $derived(path ? path.slice(path.lastIndexOf('/') + 1) : '');
	let pageable = $derived(imagePopoutStore.images.length > 1);

	/** The path whose file would not load. Held by path rather than as a bare flag so paging
	 *  to a picture that is still there clears it by itself. The window keeps a snapshot of
	 *  the set, so an image deleted from the gallery meanwhile lands here. */
	let missing = $state<string | null>(null);
</script>

<FloatingWindow
	open={imagePopoutStore.open}
	storageKey="image-popout-rect"
	minSize={{ w: 260, h: 200 }}
	defaultSize={{ w: 460, h: 460 }}
	ariaLabel={imagePopoutStore.label}
>
	{#snippet header()}
		<span class="popout-name" title={filename}>{filename}</span>

		{#if pageable}
			<button
				type="button"
				class="popout-btn"
				onclick={() => imagePopoutStore.step(-1)}
				title="Previous image"
				aria-label="Previous image"
			>
				<Icon name="chevronLeft" class="w-4 h-4" strokeWidth={1.8} />
			</button>
			<span class="popout-count">{imagePopoutStore.index + 1} / {imagePopoutStore.images.length}</span>
			<button
				type="button"
				class="popout-btn"
				onclick={() => imagePopoutStore.step(1)}
				title="Next image"
				aria-label="Next image"
			>
				<Icon name="chevronRight" class="w-4 h-4" strokeWidth={1.8} />
			</button>
		{/if}

		<button
			type="button"
			class="popout-btn"
			onclick={() => imagePopoutStore.close()}
			title="Close"
			aria-label="Close pop-out"
		>
			<Icon name="close" class="w-4 h-4" strokeWidth={1.8} />
		</button>
	{/snippet}

	{#if path && missing === path}
		<p class="popout-missing">That image is no longer there.</p>
	{:else if path}
		<img class="popout-image" {src} alt={imagePopoutStore.label} onerror={() => (missing = path)} />
	{/if}
</FloatingWindow>

<style>
	.popout-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.popout-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.popout-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.popout-count {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	/* The body is a flex row from FloatingWindow, so the picture centres itself in whatever
	   shape the reader drags the window into and never dictates that shape back. */
	.popout-image {
		margin: auto;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}

	.popout-missing {
		margin: auto;
		padding: 0 1rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}
</style>
