<script lang="ts">
	/**
	 * The gallery window: one picture from somebody's gallery, kept on screen while you work
	 * anywhere else in the app, and a browser for choosing which.
	 *
	 * Mounted once at the shell's top level and driven by `imagePopoutStore`. It browses for
	 * its own images, which is what makes it a panel you open rather than one that has to be
	 * made for you: there used to be exactly one way in, popping a picture out of the library's
	 * full-screen viewer, and no way back to a different picture that did not go through the
	 * library again.
	 *
	 * Paging is by the two header buttons and nothing else. A window-level arrow-key handler
	 * would have to know whether this window or the composer had the reader's attention, and
	 * getting that wrong steals the arrow keys from typing. Two buttons cannot be wrong.
	 *
	 * The browse mode is component state, not store state, and deliberately: it is where the
	 * reader has got to in a picker, which means nothing once the window is put away and should
	 * not survive being reopened somewhere else. What the window IS showing is the store's.
	 *
	 * This is also where the window is told the reader has moved to another story, that its
	 * picture's gallery has been deleted, and which stories still exist, because it is the one
	 * part of the feature mounted for the app's whole life. See the three effects.
	 */
	import { untrack } from 'svelte';
	import Icon from './Icon.svelte';
	import FloatingWindow from './FloatingWindow.svelte';
	import EmptyState from './EmptyState.svelte';
	import { imagePopoutStore } from '$lib/stores/imagePopout.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { browsableCards, personaCount, type GalleryCard } from '$lib/utils/gallery-browser';
	import { imageService } from '$lib/services/imageService';
	import { fileUrl } from '$lib/services/transport';
	import { portraitFocusAim } from '$lib/utils/portrait-focus';

	let path = $derived(imagePopoutStore.images[imagePopoutStore.index] ?? null);
	let src = $derived(path ? fileUrl(path) : '');
	let filename = $derived(path ? path.slice(path.lastIndexOf('/') + 1) : '');
	let pageable = $derived(imagePopoutStore.images.length > 1);

	/** The window's name. The card's, when one is loaded, because that is what the reader
	 *  chose it by and the filename is rarely anything they picked. Not truncated here: the
	 *  header title is `flex: 1` with an ellipsis, so the CSS already cuts it to the room
	 *  actually available, and a character cap would cut a short name on a wide window. */
	let title = $derived(imagePopoutStore.sourceName ?? 'Gallery');

	/** The path whose file would not load. Held by path rather than as a bare flag so paging
	 *  to a picture that is still there clears it by itself. The window keeps a snapshot of
	 *  the set, so an image deleted from the gallery meanwhile lands here. */
	let missing = $state<string | null>(null);

	// ---- The browser ----
	let browsing = $state(false);
	/** Which card's gallery is being shown, or null for the card picker. The two levels. */
	let browseCardId = $state<string | null>(null);

	let cards = $derived(browsableCards(characterLibraryStore.entries));
	/** Personas sit at the front, so the count is where the seam between the groups goes. */
	let split = $derived(personaCount(cards));
	let personas = $derived(cards.slice(0, split));
	let characters = $derived(cards.slice(split));
	let browseCard = $derived(cards.find((c) => c.id === browseCardId) ?? null);

	// A card deleted while its gallery is open on screen would otherwise leave the picker on a
	// level with nothing in it and no card to name. Falling back to the card list is the same
	// answer the back arrow gives, arrived at without a press.
	$effect(() => {
		if (browseCardId && !browseCard) browseCardId = null;
	});

	// Putting the window away ends the browse. Where the reader had got to in a picker is not
	// something to be returned to days later in another story; the picture is.
	$effect(() => {
		if (!imagePopoutStore.open) {
			browsing = false;
			browseCardId = null;
		}
	});

	function openBrowser(): void {
		browsing = true;
		// Always at the top level. Reopening on the card a previous browse ended in would be
		// guessing, and the one press it saves costs a press to undo when the guess is wrong.
		browseCardId = null;
	}

	function choose(card: GalleryCard, at: number): void {
		imagePopoutStore.show(card.gallery, at, { sourceId: card.id, name: card.name });
		browsing = false;
		browseCardId = null;
		missing = null;
	}

	/** The card's own portrait for its tile, at thumbnail size. The server answers a missing
	 *  thumbnail with the original beside it, so this can never draw a broken tile. */
	function tileSrc(imageUrl: string | undefined): string | null {
		return imageService.thumbnailUrl(imageUrl);
	}

	/** The chat this effect last saw loaded. Held as a plain variable rather than a rune on
	 *  purpose: it is the effect's own bookkeeping and nothing renders it. `undefined` is
	 *  "not yet run", which is distinct from the `null` of the welcome screen. */
	let lastChatId: string | null | undefined = undefined;

	// Hand the window over to whichever story the reader is now in. Deliberately an EDGE, not
	// an invariant: it acts only when the loaded chat actually changes, so choosing a picture
	// while a chat is on screen is left alone. Re-asserting "the window must belong to the open
	// chat" on every tick would shut that window the instant it opened.
	//
	// The LOADED chat, not the active id: the id is claimed the moment a row is clicked and
	// the rows land a couple of hundred milliseconds later, so keying on it would swap the
	// window out from under a story still on screen. Same reasoning, same choice, as the
	// notepad's twin.
	$effect(() => {
		const chatId = chatStore.currentChatState?.chat.id ?? null;
		if (chatId === lastChatId) return;
		lastChatId = chatId;
		untrack(() => imagePopoutStore.followChat(chatId));
	});

	// Empty the window when the library entry its picture came from is deleted, which sweeps
	// that entry's image files with it.
	//
	// This one IS an invariant, and the distinction from the edge above is the whole reason it
	// is allowed to be. That edge cannot be re-asserted continuously because "the window
	// belongs to the story on screen" is legitimately false for a frame. "The picture's gallery
	// still exists" is never legitimately false, since nothing can load a picture from an entry
	// that is not there, so asserting it every tick fights nothing.
	//
	// It is also the only thing that can notice: deleting a character happens inside the story
	// you are reading, so the chat never changes and the edge above never fires. Guarded on
	// `initialized` so a library that has not loaded yet never reads as a library with
	// everything deleted out of it.
	$effect(() => {
		const sourceId = imagePopoutStore.sourceId;
		if (!sourceId || !characterLibraryStore.initialized) return;
		if (characterLibraryStore.entries.some((e) => e.id === sourceId)) return;
		untrack(() => imagePopoutStore.forgetEntry(sourceId));
	});

	// Sweep remembered windows for stories that no longer exist. Driven off the live chat list
	// rather than out of the delete paths, so one row, a batch, and a delete arriving from
	// another device are all the same event here and no caller has to know this feature exists.
	// Cheap: it writes only when something actually goes.
	$effect(() => {
		const live = new Set(chatStore.chats.map((c) => c.id));
		untrack(() => imagePopoutStore.pruneTo(live));
	});
</script>

<!-- One tile recipe, rendered by both groups. A snippet rather than a copy per group, because
     the two differ only in which list they walk and a second copy is a second thing to keep in
     step with the first. -->
{#snippet cardTile(card: GalleryCard)}
	<button
		type="button"
		class="gb-tile"
		onclick={() => (browseCardId = card.id)}
		title="{card.name} · {card.gallery.length} image{card.gallery.length === 1 ? '' : 's'}"
	>
		{#if card.imageUrl}
			<img
				class="gb-img"
				src={tileSrc(card.imageUrl)}
				alt=""
				loading="lazy"
				style={portraitFocusAim(card.portraitFocus)}
			/>
		{:else}
			<!-- The same person glyph the library's own grids draw for a card with no portrait,
			     so a card reads the same in both places. -->
			<span class="gb-noportrait"><Icon name="user" class="w-8 h-8" strokeWidth={1} /></span>
		{/if}
		<span class="gb-label">{card.name}</span>
	</button>
{/snippet}

<FloatingWindow
	open={imagePopoutStore.open}
	storageKey="image-popout-rect"
	minSize={{ w: 260, h: 220 }}
	defaultSize={{ w: 460, h: 460 }}
	ariaLabel={imagePopoutStore.sourceName ? `${imagePopoutStore.sourceName} gallery` : 'Gallery'}
>
	{#snippet header()}
		<span class="popout-name" title={filename ? `${title} · ${filename}` : title}>{title}</span>

		<!-- Paging is for a set with somewhere to go: hidden with nothing loaded, and hidden for
		     a gallery of one, where both arrows would land back on the picture already shown. -->
		{#if pageable && !browsing}
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
			class:is-active={browsing}
			aria-pressed={browsing}
			onclick={() => (browsing ? (browsing = false) : openBrowser())}
			title={browsing ? 'Stop choosing' : 'Choose an image'}
			aria-label={browsing ? 'Stop choosing an image' : 'Choose an image'}
		>
			<Icon name="gallery" class="w-4 h-4" strokeWidth={1.8} />
		</button>

		<!-- Empties the window and forgets the picture for this story. The destructive one of
		     the three, and the only one of them that touches what is loaded. -->
		<button
			type="button"
			class="popout-btn"
			onclick={() => imagePopoutStore.unload()}
			disabled={!imagePopoutStore.hasImage}
			title="Remove this image from the window"
			aria-label="Remove this image from the window"
		>
			<Icon name="close" class="w-4 h-4" strokeWidth={1.8} />
		</button>

		<!-- Puts the window away and keeps everything. The title bar entry brings it back, which
		     is what makes this a minimise rather than a close. -->
		<button
			type="button"
			class="popout-btn"
			onclick={() => imagePopoutStore.minimize()}
			title="Hide the window (the image is kept)"
			aria-label="Hide the gallery window"
		>
			<Icon name="minimize" class="w-4 h-4" strokeWidth={1.8} />
		</button>
	{/snippet}

	{#if browsing}
		<div class="gb">
			{#if browseCard}
				<div class="gb-grid">
					<!-- The back arrow takes the top-left cell rather than a row of its own: the
					     grid is the whole body of a small window, and a header above it would cost
					     a row of pictures to say one word. -->
					<button
						type="button"
						class="gb-tile gb-tile--back"
						onclick={() => (browseCardId = null)}
						title="Back to the cards"
						aria-label="Back to the cards"
					>
						<Icon name="arrowLeft" class="w-6 h-6" strokeWidth={1.5} />
					</button>
					{#each browseCard.gallery as image, at (image)}
						<button
							type="button"
							class="gb-tile"
							class:is-current={image === path}
							onclick={() => choose(browseCard, at)}
							title={image.slice(image.lastIndexOf('/') + 1)}
						>
							<img
								class="gb-img"
								src={tileSrc(image)}
								alt=""
								loading="lazy"
							/>
						</button>
					{/each}
				</div>
			{:else if cards.length === 0}
				<EmptyState icon="gallery" size="sm">
					No card has any gallery images yet. Add some in the Library and they show up here.
				</EmptyState>
			{:else}
				{#if personas.length > 0}
					<div class="gb-grid">
						{#each personas as card (card.id)}
							{@render cardTile(card)}
						{/each}
					</div>
				{/if}
				{#if personas.length > 0 && characters.length > 0}
					<!-- Personas and characters are two kinds of thing, so the grid says so rather
					     than running them together into one alphabetical wall. -->
					<div class="gb-seam" aria-hidden="true"></div>
				{/if}
				{#if characters.length > 0}
					<div class="gb-grid">
						{#each characters as card (card.id)}
							{@render cardTile(card)}
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{:else if path && missing === path}
		<p class="popout-missing">That image is no longer there.</p>
	{:else if path}
		<img class="popout-image" {src} alt={title} onerror={() => (missing = path)} />
	{:else}
		<div class="popout-empty">
			<EmptyState icon="image" size="sm">
				{#snippet actions()}
					<button type="button" class="popout-cta" onclick={openBrowser}>Choose an image</button>
				{/snippet}
				Nothing pinned here yet.
			</EmptyState>
		</div>
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

	.popout-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.popout-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* The browse button stays lit while the picker is up, because the picker replaces the
	   picture and the reader needs to see which press put it there. */
	.popout-btn.is-active {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		color: var(--color-accent);
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
		padding: 1rem;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.popout-empty {
		margin: auto;
		padding: 0.75rem;
	}

	.popout-cta {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.popout-cta:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	/* ---- The browser ---- */
	/* Scrolls itself rather than growing the window: the body is a fixed box and the picker is
	   the one thing in here whose length the reader does not control. */
	.gb {
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		padding: 0.5rem;
	}

	/* auto-fill rather than auto-fit: a gallery of one keeps a tile the size of every other
	   tile instead of one picture stretched across the window. */
	.gb-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
		gap: 0.4rem;
	}

	.gb-seam {
		height: 1px;
		margin: 0.6rem 0.15rem;
		background: var(--color-border-subtle);
	}

	.gb-tile {
		position: relative;
		aspect-ratio: 3 / 4;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: border-color 120ms ease, color 120ms ease;
	}

	.gb-tile:hover {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: var(--color-text-primary);
	}

	/* The picture already on screen, so a reader who opens the picker to page around can see
	   where they are rather than counting. */
	.gb-tile.is-current {
		border-color: var(--color-accent);
	}

	.gb-tile--back {
		aspect-ratio: 3 / 4;
		background: transparent;
		border-style: dashed;
		border-color: var(--color-border-subtle);
	}

	.gb-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.gb-noportrait {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Sits over the foot of the tile rather than under it, so every tile is the same height
	   whatever the length of the name on it. */
	.gb-label {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 0.2rem 0.3rem;
		background: color-mix(in srgb, var(--color-bg-primary) 78%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 600;
		line-height: 1.2;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
