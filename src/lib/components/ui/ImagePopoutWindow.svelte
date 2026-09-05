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
	 *
	 * This is also where the window is told the reader has moved to another story, that its
	 * picture's gallery has been deleted, and which stories still exist, because it is the
	 * one part of the feature mounted for the app's whole life. See the three effects.
	 */
	import { untrack } from 'svelte';
	import Icon from './Icon.svelte';
	import FloatingWindow from './FloatingWindow.svelte';
	import { imagePopoutStore } from '$lib/stores/imagePopout.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { fileUrl } from '$lib/services/transport';

	let path = $derived(imagePopoutStore.images[imagePopoutStore.index] ?? null);
	let src = $derived(path ? fileUrl(path) : '');
	let filename = $derived(path ? path.slice(path.lastIndexOf('/') + 1) : '');
	let pageable = $derived(imagePopoutStore.images.length > 1);

	/** The path whose file would not load. Held by path rather than as a bare flag so paging
	 *  to a picture that is still there clears it by itself. The window keeps a snapshot of
	 *  the set, so an image deleted from the gallery meanwhile lands here. */
	let missing = $state<string | null>(null);

	/** The chat this effect last saw loaded. Held as a plain variable rather than a rune on
	 *  purpose: it is the effect's own bookkeeping and nothing renders it. `undefined` is
	 *  "not yet run", which is distinct from the `null` of the welcome screen. */
	let lastChatId: string | null | undefined = undefined;

	// Hand the window over to whichever story the reader is now in. Deliberately an EDGE, not
	// an invariant: it acts only when the loaded chat actually changes, so popping a picture
	// out of the library while a chat is on screen is left alone. Re-asserting "the window
	// must belong to the open chat" on every tick would shut that window the instant it
	// opened, and the library is reachable from inside any chat.
	//
	// The LOADED chat, not the active id: the id is claimed the moment a row is clicked and
	// the rows land a couple of hundred milliseconds later, so keying on it would swap the
	// window out from under a story still on screen. Same reasoning, same choice, as the
	// notepad's twin.
	//
	// Skipped on mobile, where the window is unreachable by design: `FloatingWindow` renders
	// nothing there and the toolbar button that opens it is hidden, so restoring one would
	// mean state nobody can see or close.
	$effect(() => {
		const chatId = chatStore.currentChatState?.chat.id ?? null;
		if (chatId === lastChatId) return;
		lastChatId = chatId;
		if (!viewport.isMobile) untrack(() => imagePopoutStore.followChat(chatId));
	});

	// Close the window when the library entry its picture came from is deleted, which sweeps
	// that entry's image files with it.
	//
	// This one IS an invariant, and the distinction from the edge above is the whole reason
	// it is allowed to be. That edge cannot be re-asserted continuously because "the window
	// belongs to the story on screen" is legitimately false for a frame: a picture is popped
	// out from the library, and the library is opened from inside a chat. "The picture's
	// gallery still exists" is never legitimately false, since nothing can pop a picture out
	// of an entry that is not there, so asserting it every tick fights nothing.
	//
	// It is also the only thing that can notice: deleting a character happens inside the
	// story you are reading, so the chat never changes and the edge above never fires.
	// Guarded on `initialized` so a library that has not loaded yet never reads as a library
	// with everything deleted out of it.
	$effect(() => {
		const sourceId = imagePopoutStore.open ? imagePopoutStore.sourceId : null;
		if (!sourceId || !characterLibraryStore.initialized) return;
		if (characterLibraryStore.entries.some((e) => e.id === sourceId)) return;
		untrack(() => imagePopoutStore.forgetEntry(sourceId));
	});

	// Sweep remembered pictures for stories that no longer exist. Driven off the live chat
	// list rather than out of the delete paths, so one row, a batch, and a delete arriving
	// from another device are all the same event here and no caller has to know this feature
	// exists. Cheap: it writes only when something actually goes.
	$effect(() => {
		const live = new Set(chatStore.chats.map((c) => c.id));
		untrack(() => imagePopoutStore.pruneTo(live));
	});
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
