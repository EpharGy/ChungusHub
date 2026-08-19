<script lang="ts">
	/**
	 * The chat character's sprite, standing at the bottom-left of the screen.
	 *
	 * A bare picture and nothing else. Sprites are drawn as cut-outs on transparent
	 * backgrounds, so a surface behind one, a border around it, a name plate over its feet or
	 * the letterbox a contained image leaves are all frame the artwork was made without. It is
	 * flush with the bottom edge for the same reason: a gap under a standing figure reads as a
	 * picture of a person, and no gap reads as the person.
	 *
	 * It takes no pointer events. The sprite is the chat's own state rather than something the
	 * reader opened, so it has nothing to click and must not swallow what is under it, which on
	 * a narrow window is the composer. The portrait card (`PortraitViewer`) draws over it when
	 * the reader opens one, and that is why the two are separate components: they share this
	 * corner and nothing else, one being a bare picture and the other a card with a close
	 * button.
	 *
	 * Not drawn on phones at all: see the caller.
	 */
	import { spriteStore } from '$lib/stores/sprites.svelte';
	import { imageService } from '$lib/services/imageService';

	const path = $derived(spriteStore.spritePath);
	// The stored file, since sprites are uploaded without a thumbnail (a jpeg thumbnail would
	// fill the cut-out back in with black).
	const url = $derived(imageService.imageUrl(path ?? undefined));

	// Ask on every change; the store decides whether that means a call.
	$effect(() => {
		spriteStore.ensureRead();
	});

	const status = $derived(spriteStore.status);
	const statusLabel = $derived(
		{
			read: 'Sprite is up to date',
			reading: 'Reading this reply…',
			failed: 'Could not read this reply. Click to read it again',
			idle: 'Waiting for a reply to read'
		}[status]
	);
</script>

{#if url}
	<div class="sprite-layer fade-in">
		<img src={url} alt={spriteStore.characterName ?? 'Sprite'} class="sprite-image" />
		<!-- The engine's state, in the corner of the picture it produced. Without it a dead
		     engine looks exactly like a calm one: the face simply holds the last thing it read.
		     The failed one is a button because that state is the one the reader can end. -->
		{#if status === 'failed'}
			<button
				type="button"
				class="sprite-status sprite-status-failed"
				onclick={() => spriteStore.retry()}
				aria-label={statusLabel}
				title={statusLabel}
			></button>
		{:else}
			<span class="sprite-status sprite-status-{status}" title={statusLabel}></span>
		{/if}
	</div>
{/if}

<style>
	/* The bay beside the chat column, the same box the portrait card centers in (app.css).
	   Sizing the layer rather than the picture is what makes the figure's presence the same
	   whatever it is a picture of: it is drawn as large as fits inside this box. */
	.sprite-layer {
		position: fixed;
		left: 0;
		bottom: 0;
		/* Under the portrait card (15) so an opened portrait wins the corner, under the docked
		   side panels (25), above the chat column. */
		z-index: 14;
		width: var(--picture-bay);
		height: var(--picture-height);
		/* Ambient: nothing here is clickable except the status dot, which takes it back. */
		pointer-events: none;
	}

	.sprite-image {
		width: 100%;
		height: 100%;
		display: block;
		/* Contained, so the whole figure is there at its own proportions whatever the bay's
		   shape; centred in the bay so the empty margin sits evenly on both sides of it
		   rather than all of it between the figure and the story; and grounded on the bottom
		   edge, where the layer is flush with the screen. */
		object-fit: contain;
		object-position: bottom center;
	}

	/* The bay's own bottom-left corner, not the picture's: a status light belongs in one
	   place the eye can go back to, and a picture's corner moves with every sprite. */
	.sprite-status {
		position: absolute;
		left: 0.6rem;
		bottom: 0.6rem;
		width: 0.5rem;
		height: 0.5rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-full);
		/* Sits on the artwork, which can be any colour: the dark ring is what keeps it
		   readable on a pale sprite. */
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
		/* The one thing on this layer that takes events back from it, so hovering says the
		   state in words and the failed one can be pressed. */
		pointer-events: auto;
	}

	.sprite-status-read {
		background: var(--color-success);
		opacity: 0.7;
	}

	.sprite-status-idle {
		background: var(--color-text-muted);
		opacity: 0.7;
	}

	.sprite-status-reading {
		background: var(--color-warning);
		animation: spritePulse 1.1s ease-in-out infinite;
	}

	.sprite-status-failed {
		background: var(--color-error);
		cursor: pointer;
		transition: transform 120ms ease;
	}

	/* The dot stays a dot; the press target around it is finger-sized. */
	.sprite-status-failed::after {
		content: '';
		position: absolute;
		inset: -0.55rem;
	}

	.sprite-status-failed:hover {
		transform: scale(1.2);
	}

	@keyframes spritePulse {
		0%,
		100% {
			opacity: 0.35;
		}

		50% {
			opacity: 1;
		}
	}
</style>
