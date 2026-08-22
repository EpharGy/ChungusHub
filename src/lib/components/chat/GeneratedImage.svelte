<script lang="ts">
	/**
	 * One marker's place in a reply: the picture it asked for, or the state it is in.
	 *
	 * Four states, and the reason they all live in one component is that a marker moves
	 * between them without moving on the page: waiting to be asked for, generating, failed
	 * with a reason, and finally a picture. Splitting them across components is how a
	 * transcript ends up jumping every time a picture lands.
	 *
	 * The controls are part of the component rather than nodes bolted onto the rendered HTML
	 * afterwards, which is the whole reason this can be re-rendered freely: nothing here has
	 * to be re-attached after a stream patches the body around it.
	 */
	import { imagegenStore } from '$lib/stores/imagegen.svelte';
	import { imageService } from '$lib/services/imageService';
	import { wasRepaired } from '$lib/imagegen/parse';
	import type { MarkerMatch } from '$lib/imagegen/types';
	import type { Message } from '$lib/types/chat';

	interface Props {
		message: Message;
		marker: MarkerMatch;
	}

	let { message, marker }: Props = $props();

	const attachment = $derived(
		(message.attachments ?? []).find((a) => a.generated?.marker === marker.index) ?? null
	);
	const status = $derived(imagegenStore.statusFor(message.id, marker.index));
	const error = $derived(imagegenStore.errorFor(message.id, marker.index));
	const meta = $derived(attachment?.generated ?? null);
	const url = $derived(attachment ? imageService.imageUrl(attachment.path) : null);

	/** The prompt as it was actually written, for the title text on the picture. A reader
	 *  wondering why they got what they got is asking about this string. */
	const promptText = $derived(
		meta?.prompt ?? (marker.result.status === 'ok' ? marker.result.prompt : marker.raw)
	);
	const repaired = $derived(marker.result.status === 'ok' && wasRepaired(marker.result.repairMeta));

	/** A marker the parser could not save. Nothing to generate, so the reader is told what
	 *  the model wrote instead of being shown a button that cannot work. */
	const parseError = $derived(marker.result.status === 'parse_error' ? marker.result.reason : null);
</script>

{#if url && meta}
	<figure class="generated-image">
		<img
			src={url}
			alt={promptText}
			title={promptText}
			loading="lazy"
			width={meta.width}
			height={meta.height}
		/>
		<div class="generated-actions">
			{#if status === 'working'}
				<span class="generated-chip" title="Generating a new picture">…</span>
			{:else}
				<button
					type="button"
					class="generated-chip"
					title="Generate again with a new seed"
					onclick={() => imagegenStore.retry(message.id, marker.index)}
					aria-label="Generate this image again"
				>
					↻
				</button>
				<button
					type="button"
					class="generated-chip"
					title="Remove this picture and put the marker back"
					onclick={() => imagegenStore.forget(message.id, marker.index)}
					aria-label="Remove this image"
				>
					✕
				</button>
			{/if}
		</div>
		<figcaption class="generated-caption">seed {meta.seed}</figcaption>
	</figure>
{:else if status === 'working'}
	<div class="generated-placeholder" role="status">
		<span class="generated-spinner" aria-hidden="true"></span>
		<span>Generating…</span>
	</div>
{:else if parseError}
	<div class="generated-placeholder generated-broken">
		<span
			>Image marker {parseError === 'empty_marker' ? 'was empty' : 'had no prompt in it'}.</span
		>
	</div>
{:else}
	<!-- No picture yet: either the engine is off, auto-generate is off, or the last attempt
	     failed. All three end in the same place — a marker the reader can act on. -->
	<div class="generated-placeholder" class:generated-broken={status === 'error'}>
		<span class="generated-prompt" title={promptText}>{promptText}</span>
		{#if status === 'error' && error}
			<span class="generated-error" title={error}>{error}</span>
		{/if}
		{#if repaired}
			<span class="generated-note">marker repaired</span>
		{/if}
		{#if imagegenStore.active}
			<button
				type="button"
				class="generated-chip"
				onclick={() => imagegenStore.generateOne(message.id, marker.index)}
			>
				{status === 'error' ? 'Try again' : 'Generate'}
			</button>
		{/if}
	</div>
{/if}

<style>
	.generated-image {
		position: relative;
		display: block;
		margin: 0.75rem 0;
		max-width: min(100%, 40rem);
	}

	.generated-image img {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 0.5rem;
	}

	/* Controls sit over the picture and stay out of the way until the pointer is on it.
	   Always visible on touch, where there is no hover to reveal them. */
	.generated-actions {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.generated-image:hover .generated-actions,
	.generated-image:focus-within .generated-actions {
		opacity: 1;
	}

	@media (hover: none) {
		.generated-actions {
			opacity: 1;
		}
	}

	.generated-chip {
		border: none;
		border-radius: 0.35rem;
		padding: 0.15rem 0.5rem;
		font-size: 0.8rem;
		line-height: 1.4;
		cursor: pointer;
		background: color-mix(in srgb, var(--color-surface, #222) 75%, transparent);
		color: var(--color-text, #eee);
		backdrop-filter: blur(2px);
	}

	.generated-caption {
		margin-top: 0.2rem;
		font-size: 0.7rem;
		opacity: 0.5;
	}

	.generated-placeholder {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0.75rem 0;
		padding: 0.5rem 0.75rem;
		border: 1px dashed color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
		font-size: 0.85rem;
		opacity: 0.8;
	}

	.generated-broken {
		border-style: solid;
		border-color: color-mix(in srgb, var(--color-danger, #c33) 45%, transparent);
	}

	.generated-prompt {
		flex: 1 1 12rem;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-style: italic;
	}

	.generated-error,
	.generated-note {
		font-size: 0.75rem;
		opacity: 0.75;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.generated-spinner {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: generated-spin 900ms linear infinite;
	}

	@keyframes generated-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* A long generation is a still page otherwise, and a still page reads as a crash. */
	@media (prefers-reduced-motion: reduce) {
		.generated-spinner {
			animation-duration: 3s;
		}
	}
</style>
