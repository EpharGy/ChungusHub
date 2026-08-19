<script lang="ts">
	/**
	 * The pictures the Sprites engine picks between, each named by the label it answers with.
	 * They are their own set and are uploaded here: the Gallery above holds the character's
	 * art and nothing of this grid's, or a set of forty would bury it.
	 *
	 * The tile's corner X deletes the picture, the same act the Gallery's X performs: one
	 * glyph in one corner means one thing in both grids.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { imageService, imageRejectionReason } from '$lib/services/imageService';
	import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
	import { spriteSortPref } from '$lib/stores/spriteSort.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { labelFromFilename, sortSprites } from '$lib/utils/sprites';
	import type { CharacterSprite } from '$lib/types/library';

	interface Props {
		sprites: CharacterSprite[] | undefined;
		defaultSprite: string | undefined;
		onAddFiles: (items: { file: File; label: string }[]) => Promise<void>;
		/** Open the rename dialog on this sprite. Owned by the form, which mounts it. */
		onEditLabel: (path: string, label: string) => void;
		onRemove: (path: string) => Promise<void>;
		onSetDefault: (path: string) => Promise<void>;
	}

	let { sprites, defaultSprite, onAddFiles, onEditLabel, onRemove, onSetDefault }: Props = $props();

	// Sorted for the eye only: the stored list keeps the order the files arrived in, which is
	// what the section heading's Upload order goes back to.
	const items = $derived(sortSprites(sprites ?? [], spriteSortPref.order));

	let fileInputRef = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);

	async function handleFilesSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';

		const valid: File[] = [];
		for (const file of files) {
			const refused = imageRejectionReason(file);
			if (refused) toastStore.error(refused);
			else valid.push(file);
		}
		if (valid.length === 0) return;

		uploading = true;
		try {
			// A file's own name is the label a sprite pack already carries, so an upload arrives
			// labelled and the user only renames what they disagree with.
			await onAddFiles(valid.map((file) => ({ file, label: labelFromFilename(file.name) })));
		} catch (error) {
			console.error('Adding sprites failed:', error);
			toastStore.failed(valid.length === 1 ? 'add that sprite' : `add those ${valid.length} sprites`, error);
		} finally {
			uploading = false;
		}
	}

	async function handleRemove(e: Event, sprite: CharacterSprite) {
		e.stopPropagation();
		try {
			await onRemove(sprite.path);
		} catch (error) {
			console.error('Removing a sprite failed:', error);
			toastStore.failed('remove that sprite', error);
		}
	}

	async function handleSetDefault(e: Event, sprite: CharacterSprite) {
		e.stopPropagation();
		try {
			await onSetDefault(sprite.path);
		} catch (error) {
			console.error('Setting the default sprite failed:', error);
			toastStore.failed('make that the default', error);
		}
	}

	/** Lands on the Sprites engine's own detail page: gotoSettingsPage first, since it is
	 *  the only thing that clears whichever engine detail was last open. */
	function openSpriteSettings() {
		uiStore.gotoSettingsPage('engines');
		uiStore.settingsEngineId = 'sprites';
		uiStore.openSettings();
	}
</script>

<input
	bind:this={fileInputRef}
	type="file"
	accept="image/*"
	multiple
	class="hidden"
	onchange={handleFilesSelected}
/>

{#if items.length > 0 && !featurePromptsStore.spritesEnabled}
	<!-- Answers "I uploaded pictures and nothing happens" where the uploading happens, which
	     is the whole reason the engine can ship off without becoming a trap. Only once there is
	     something to answer for: on an empty set it would be an error message about nothing. -->
	<p class="text-xs font-ui text-text-muted">
		Sprites is off, so these stay in the library.
		<button type="button" class="text-accent hover:underline" onclick={openSpriteSettings}>
			Turn it on in Settings
		</button>
	</p>
{/if}

<div class="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2">
	{#each items as sprite (sprite.path)}
		<!-- Tiles are portrait and the picture is contained, never cropped: sprites are drawn
		     tall (3:4 and taller), and a square cover crop takes the face off the top of one. -->
		<div
			class="group/tile relative aspect-[3/4] rounded-[var(--radius-md)] overflow-hidden border bg-bg-tertiary cursor-pointer transition-colors {sprite.path ===
			defaultSprite
				? 'border-accent'
				: 'border-border-subtle hover:border-accent'}"
			role="button"
			tabindex="0"
			onclick={() => onEditLabel(sprite.path, sprite.label)}
			onkeydown={(e) => e.key === 'Enter' && onEditLabel(sprite.path, sprite.label)}
			aria-label="Rename {sprite.label}"
		>
			<img
				src={imageService.thumbnailUrl(sprite.path)}
				alt=""
				loading="lazy"
				class="w-full h-full object-contain"
			/>
			<div class="sprite-label">{sprite.label}</div>
			{#if sprite.path === defaultSprite}
				<div class="sprite-badge" title="Shown until the engine reads a reply">Default</div>
			{:else}
				<button
					type="button"
					class="sprite-action absolute top-1 left-1 p-1 rounded-full bg-black/50 text-white/80 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-accent hover:text-white"
					onclick={(e) => handleSetDefault(e, sprite)}
					aria-label="Make {sprite.label} the default"
				>
					<Icon name="star" class="w-3.5 h-3.5" />
				</button>
			{/if}
			<button
				type="button"
				class="sprite-action absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white/80 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-error hover:text-white"
				onclick={(e) => handleRemove(e, sprite)}
				aria-label="Remove {sprite.label}"
			>
				<Icon name="close" class="w-3.5 h-3.5" />
			</button>
		</div>
	{/each}

	<button
		type="button"
		onclick={() => fileInputRef?.click()}
		disabled={uploading}
		class="aspect-[3/4] rounded-[var(--radius-md)] border border-dashed border-border flex flex-col items-center justify-center gap-1 text-text-muted hover:text-accent hover:border-accent/50 transition-colors"
		aria-label="Add sprites"
	>
		{#if uploading}
			<Spinner size="md" />
		{:else}
			<Icon name="plus" class="w-5 h-5" />
			<span class="text-xs font-ui">Add</span>
		{/if}
	</button>
</div>

{#if items.length === 0}
	<p class="text-xs font-ui text-text-muted">
		Add pictures here. Each takes its name from the filename, and that name is what the engine
		picks it by.
	</p>
{/if}

<style>
	.sprite-label {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 1.1rem 0.4rem 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		text-align: center;
		color: #fff;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.78), transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}

	.sprite-badge {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-full);
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 650;
		color: #fff;
		background: color-mix(in srgb, var(--color-accent) 85%, transparent);
		pointer-events: none;
	}

	/* Reveal-on-hover is Tailwind's, above. A touch screen has no hover to reveal with, so the
	   corner actions stay put there. The rule `.portrait-overlay-action` follows in app.css.
	   `!important` because it is overruling a utility class on the same element. */
	@media (pointer: coarse) {
		.sprite-action {
			opacity: 1 !important;
		}
	}
</style>
