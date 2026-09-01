<script lang="ts">
	/**
	 * The character's art: extra pictures that hang off the entry and open full size in the
	 * lightbox. Nothing here means anything to the engine: the sprites it picks between are
	 * their own set in their own section below, so a picture is in one grid or the other and a
	 * removal here can never take a sprite's file with it.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { imagePopoutStore } from '$lib/stores/imagePopout.svelte';
	import { imageService, imageRejectionReason } from '$lib/services/imageService';

	interface Props {
		gallery: string[] | undefined;
		/** Names the pop-out window, so a picture kept on screen still says whose it is once
		 *  the editor behind it is closed. */
		characterName?: string;
		onAdd: (files: File[]) => Promise<void>;
		onRemove: (path: string) => Promise<void>;
	}

	let { gallery, characterName, onAdd, onRemove }: Props = $props();

	/** Hand the picture to the floating window and get out of its way: leaving the
	 *  full-screen viewer open would cover the window it just made. */
	function popOut(at: number) {
		imagePopoutStore.show(images, at, characterName ? `${characterName} gallery` : 'Gallery image');
		viewerIndex = null;
	}

	let images = $derived(gallery ?? []);
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let viewerIndex = $state<number | null>(null);

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
			await onAdd(valid);
		} catch (error) {
			console.error('Adding gallery images failed:', error);
			toastStore.failed(valid.length === 1 ? 'add that image' : `add those ${valid.length} images`, error);
		} finally {
			uploading = false;
		}
	}

	async function handleRemove(e: Event, path: string) {
		e.stopPropagation();
		try {
			await onRemove(path);
		} catch (error) {
			console.error('Removing a gallery image failed:', error);
			toastStore.failed('remove that image', error);
		}
	}

</script>

<!-- Hidden multi-file input -->
<input
	bind:this={fileInputRef}
	type="file"
	accept="image/*"
	multiple
	class="hidden"
	onchange={handleFilesSelected}
/>

<div class="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2">
	{#each images as path, i (path)}
		<div
			class="group/tile relative aspect-square rounded-[var(--radius-md)] overflow-hidden border border-border-subtle bg-bg-tertiary cursor-pointer transition-colors hover:border-accent"
			role="button"
			tabindex="0"
			onclick={() => (viewerIndex = i)}
			onkeydown={(e) => e.key === 'Enter' && (viewerIndex = i)}
			aria-label="View image"
		>
			<img
				src={imageService.thumbnailUrl(path)}
				alt=""
				loading="lazy"
				class="w-full h-full object-cover"
			/>
			<button
				type="button"
				class="tile-action absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white/80 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-error hover:text-white"
				onclick={(e) => handleRemove(e, path)}
				aria-label="Remove image"
			>
				<Icon name="close" class="w-3.5 h-3.5" />
			</button>
		</div>
	{/each}

	<button
		type="button"
		onclick={() => fileInputRef?.click()}
		disabled={uploading}
		class="aspect-square rounded-[var(--radius-md)] border border-dashed border-border flex flex-col items-center justify-center gap-1 text-text-muted hover:text-accent hover:border-accent/50 transition-colors"
		aria-label="Add images"
	>
		{#if uploading}
			<Spinner size="md" />
		{:else}
			<Icon name="plus" class="w-5 h-5" />
			<span class="text-xs font-ui">Add</span>
		{/if}
	</button>
</div>

<ImageLightbox
	{images}
	bind:index={viewerIndex}
	alt="Gallery image"
	onPopout={popOut}
	onClose={() => (viewerIndex = null)}
/>

<style>
	/* A touch screen has no hover to reveal the corner actions with, so they stay put there.
	   The rule `.portrait-overlay-action` follows in app.css. `!important` overrules the
	   utility class on the same element. */
	@media (pointer: coarse) {
		.tile-action {
			opacity: 1 !important;
		}
	}
</style>
