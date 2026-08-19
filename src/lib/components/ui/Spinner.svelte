<script lang="ts">
	/**
	 * The one busy indicator. Every surface that waits draws this ring, so a slow
	 * library load and a slow model list read as the same app thinking rather than
	 * as two unrelated animations.
	 *
	 * Three sizes and nothing else: `sm` sits inside a button next to its label,
	 * `md` is a card or a row, `lg` is a whole panel with nothing else in it. A
	 * call site that wants a fourth size wants one of these three.
	 *
	 * The ring is decorative: `aria-hidden`, because a spinner announces nothing a
	 * screen reader can use. The waiting SENTENCE beside it is the announcement, so
	 * a bare spinner with no text is a surface that has told a screen reader
	 * nothing; pass `label` there and it becomes the announcement instead.
	 */
	type SpinnerSize = 'sm' | 'md' | 'lg';

	interface Props {
		size?: SpinnerSize;
		/** Announced when the ring is the only thing on screen (no visible copy). */
		label?: string;
		class?: string;
	}

	let { size = 'md', label, class: className = '' }: Props = $props();
</script>

<span
	class="spinner spinner--{size} {className}"
	role={label ? 'status' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
></span>

<style>
	/* Transparent top on an accent ring: the gap is what makes the rotation
	   readable. Kept as a border rather than a conic gradient so it stays crisp at
	   1rem, where a gradient's seam is a visible notch. */
	.spinner {
		display: inline-block;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		border-style: solid;
		border-color: var(--color-accent);
		border-top-color: transparent;
		animation: spinner-turn 700ms linear infinite;
	}

	.spinner--sm {
		width: 1rem;
		height: 1rem;
		border-width: 2px;
	}

	.spinner--md {
		width: 1.5rem;
		height: 1.5rem;
		border-width: 2px;
	}

	.spinner--lg {
		width: 2rem;
		height: 2rem;
		border-width: 2px;
	}

	@keyframes spinner-turn {
		to {
			transform: rotate(1turn);
		}
	}

	/* Reduced motion still needs to say "working", so the ring pulses in place
	   rather than stopping dead and reading as a static piece of chrome. */
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: spinner-pulse 1.4s ease-in-out infinite;
		}
	}

	@keyframes spinner-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
</style>
