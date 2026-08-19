<script lang="ts">
	/**
	 * The nine work motions: one small animation per kind of work the assistant does
	 * (src/lib/config/assistant-motion.ts owns which tool is which). Eight of them belong
	 * to a running call; `idle`, the ellipsis, stands for the model's own work and is the
	 * fallback for an unmapped tool.
	 *
	 * A motion occupies exactly the 14px square the settled action's icon occupies, in the
	 * same slot, so a running row and the finished row it becomes sit in the same columns:
	 * the row matures where it stands instead of shifting when the result lands. It
	 * REPLACES that icon while the call runs rather than sitting opposite it: two symbols
	 * for one meaning is the same word twice.
	 *
	 * Every glyph's resting state (no animation) is a readable pictogram, because that
	 * frame is what a reduced-motion reader gets permanently.
	 */
	import type { WorkMotion } from '$lib/config/assistant-motion';

	/** `still` holds a glyph at its resting frame, the same one prefers-reduced-motion
	 *  leaves behind. It is what a settled conversation shows: present, and not pretending
	 *  to work. */
	let { motion, still = false }: { motion: WorkMotion; still?: boolean } = $props();
</script>

{#if motion === 'sift'}
	<span class="work work--sift" class:work--still={still} aria-hidden="true"><i></i><i></i><i></i></span>
{:else if motion === 'read'}
	<span class="work work--read" class:work--still={still} aria-hidden="true"><b></b><i></i></span>
{:else if motion === 'write'}
	<span class="work work--write" class:work--still={still} aria-hidden="true">
		<svg width="14" height="10" viewBox="0 0 14 10">
			<path d="M1 7.6C1.8 2.4 3.7 2.2 4.1 5.9c.4 3.5 2.4 3.5 2.9-.2.4-3.3 2.7-3.4 3 .2.3 3.4 2 3.2 2.8-1.1" />
		</svg>
	</span>
{:else if motion === 'make'}
	<span class="work work--make" class:work--still={still} aria-hidden="true">
		<svg width="12" height="14" viewBox="0 0 12 14">
			<rect x="1" y="1" width="10" height="12" rx="1.5" />
			<line x1="3.4" y1="5.5" x2="8.6" y2="5.5" />
			<line x1="3.4" y1="8.5" x2="7" y2="8.5" />
		</svg>
	</span>
{:else if motion === 'cut'}
	<span class="work work--cut" class:work--still={still} aria-hidden="true"><b></b><i></i></span>
{:else if motion === 'bind'}
	<span class="work work--bind" class:work--still={still} aria-hidden="true">
		<svg width="14" height="14" viewBox="0 0 14 14">
			<path d="M1 7C4 1.5 10 12.5 13 7" />
			<path d="M1 7c3 5.5 9-5.5 12 0" />
		</svg>
		<i></i><i></i>
	</span>
{:else if motion === 'look'}
	<span class="work work--look" class:work--still={still} aria-hidden="true"><b></b><em></em><i></i></span>
{:else if motion === 'go'}
	<span class="work work--go" class:work--still={still} aria-hidden="true"><i></i><b></b><em></em></span>
{:else}
	<span class="work work--idle" class:work--still={still} aria-hidden="true"><i></i><i></i><i></i></span>
{/if}

<style>
	/* The icon slot, to the pixel: w-3.5 h-3.5 on the action rows. */
	.work {
		position: relative;
		flex: 0 0 auto;
		width: 0.875rem;
		height: 0.875rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* ===== Shuffle: hunting through a stack ===== */
	.work--sift i {
		position: absolute;
		top: 2px;
		left: 3px;
		width: 6px;
		height: 10px;
		border-radius: 1.5px;
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
		animation: work-sift 2.4s cubic-bezier(0.5, 0, 0.4, 1) infinite;
	}
	.work--sift i:nth-child(2) { animation-delay: -0.8s; }
	.work--sift i:nth-child(3) { animation-delay: -1.6s; }

	@keyframes work-sift {
		0% { transform: translate(0, 0) rotate(0deg); z-index: 3; border-color: var(--color-accent); }
		22% { transform: translate(5px, -3px) rotate(14deg); z-index: 3; border-color: var(--color-accent); }
		46% { transform: translate(-3px, 2px) rotate(-9deg); z-index: 1; }
		70%, 100% { transform: translate(0, 0) rotate(0deg); z-index: 2; }
	}

	/* ===== Page: taking one thing in whole ===== */
	.work--read { perspective: 34px; }

	.work--read b {
		position: absolute;
		inset: 2px 0;
		border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
		border-radius: 2px;
	}

	.work--read i {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 50%;
		right: 1px;
		border-radius: 0 1px 1px 0;
		background: color-mix(in srgb, var(--color-accent) 75%, transparent);
		transform-origin: left center;
		animation: work-read 2.7s cubic-bezier(0.42, 0, 0.3, 1) infinite;
	}

	@keyframes work-read {
		0%, 6% { transform: rotateY(0deg); opacity: 1; }
		52% { transform: rotateY(-172deg); opacity: 1; }
		58% { transform: rotateY(-180deg); opacity: 0; }
		66% { transform: rotateY(0deg); opacity: 0; }
		74%, 100% { transform: rotateY(0deg); opacity: 1; }
	}

	/* ===== Longhand: rewriting what is already there ===== */
	.work--write path {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 1.3;
		stroke-linecap: round;
		stroke-dasharray: 32 32;
		stroke-dashoffset: 0;
		animation: work-write 3.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
	}

	@keyframes work-write {
		0% { stroke-dashoffset: 32; }
		48%, 58% { stroke-dashoffset: 0; }
		100% { stroke-dashoffset: -32; }
	}

	/* ===== Blank sheet: something new arriving ===== */
	.work--make rect {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 1.1;
		stroke-dasharray: 44;
		stroke-dashoffset: 0;
		animation: work-make-edge 2.9s cubic-bezier(0.45, 0, 0.4, 1) infinite;
	}

	.work--make line {
		stroke: color-mix(in srgb, var(--color-accent) 65%, transparent);
		stroke-width: 1.1;
		stroke-linecap: round;
		stroke-dasharray: 6;
		stroke-dashoffset: 0;
		animation: work-make-rule 2.9s ease-out infinite;
	}
	.work--make line:nth-of-type(2) { animation-delay: 0.2s; }

	@keyframes work-make-edge {
		0% { stroke-dashoffset: 44; }
		46%, 84% { stroke-dashoffset: 0; opacity: 1; }
		100% { stroke-dashoffset: 0; opacity: 0; }
	}

	@keyframes work-make-rule {
		0%, 44% { stroke-dashoffset: 6; opacity: 0; }
		62%, 84% { stroke-dashoffset: 0; opacity: 1; }
		100% { opacity: 0; }
	}

	/* ===== Strike: taking something off the page. No bounce, and the only motion
	   that uses the error colour, because a delete should not read as playful. ===== */
	.work--cut b {
		position: absolute;
		inset: 2px 1px;
		border: 1px solid color-mix(in srgb, var(--color-text-muted) 65%, transparent);
		border-radius: 1.5px;
		animation: work-cut-block 2.6s cubic-bezier(0.6, 0, 0.4, 1) infinite;
	}

	.work--cut i {
		position: absolute;
		left: 0;
		top: 50%;
		width: 100%;
		height: 1.5px;
		border-radius: 2px;
		background: var(--color-error);
		transform-origin: left center;
		transform: scaleX(1);
		animation: work-cut-line 2.6s cubic-bezier(0.6, 0, 0.4, 1) infinite;
	}

	@keyframes work-cut-block {
		0%, 22% { opacity: 1; transform: scale(1); }
		62% { opacity: 0.35; transform: scale(0.92); }
		78% { opacity: 0; transform: scale(0.86); }
		92%, 100% { opacity: 1; transform: scale(1); }
	}

	@keyframes work-cut-line {
		0%, 14% { transform: scaleX(0); opacity: 1; }
		46% { transform: scaleX(1); opacity: 1; }
		78% { transform: scaleX(1); opacity: 0; }
		100% { transform: scaleX(0); opacity: 0; }
	}

	/* ===== Braid: attaching one thing to another ===== */
	.work--bind path {
		fill: none;
		stroke: color-mix(in srgb, var(--color-text-muted) 45%, transparent);
		stroke-width: 1;
	}

	.work--bind i {
		position: absolute;
		top: 0;
		left: 0;
		width: 4px;
		height: 4px;
		margin: -2px 0 0 -2px;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		offset-rotate: 0deg;
		animation: work-bind 2.6s ease-in-out infinite;
	}
	.work--bind i:nth-of-type(1) { offset-path: path('M1 7C4 1.5 10 12.5 13 7'); }
	.work--bind i:nth-of-type(2) {
		offset-path: path('M1 7c3 5.5 9-5.5 12 0');
		background: color-mix(in oklab, var(--color-accent) 62%, white);
	}

	@keyframes work-bind {
		0% { offset-distance: 0%; }
		50% { offset-distance: 100%; }
		100% { offset-distance: 0%; }
	}

	/* ===== Develop: looking at art ===== */
	.work--look { overflow: hidden; border-radius: 2px; }

	.work--look b {
		position: absolute;
		inset: 2px 0;
		border: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
		border-radius: 2px;
	}

	.work--look em {
		position: absolute;
		inset: 4px 2px;
		border-radius: 1px;
		background: color-mix(in srgb, var(--color-accent) 30%, transparent);
		animation: work-look-fill 2.5s ease-in-out infinite;
	}

	.work--look i {
		position: absolute;
		left: 1px;
		right: 1px;
		top: -2px;
		height: 2px;
		background: color-mix(in oklab, var(--color-accent) 62%, white);
		animation: work-look-scan 2.5s cubic-bezier(0.5, 0, 0.5, 1) infinite;
	}

	@keyframes work-look-scan {
		0% { top: -2px; }
		55%, 100% { top: 14px; }
	}

	@keyframes work-look-fill {
		0%, 8% { background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
		60%, 88% { background: color-mix(in srgb, var(--color-accent) 58%, transparent); }
		100% { background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
	}

	/* ===== Landing: moving the user's own screen ===== */
	.work--go i {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 5px;
		height: 5px;
		margin: -2.5px 0 0 -2.5px;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		animation: work-go-drop 2.2s cubic-bezier(0.4, 0, 0.3, 1) infinite;
	}

	.work--go b,
	.work--go em {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 5px;
		height: 5px;
		margin: -2.5px 0 0 -2.5px;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-accent);
		opacity: 0;
		animation: work-go-ring 2.2s ease-out infinite;
	}
	.work--go em { animation-delay: 0.3s; }

	@keyframes work-go-drop {
		0% { transform: translateY(-5px) scale(0.7); opacity: 0; }
		22%, 100% { transform: translateY(0) scale(1); opacity: 1; }
	}

	@keyframes work-go-ring {
		0%, 20% { transform: scale(0.6); opacity: 0; }
		30% { opacity: 0.65; }
		75%, 100% { transform: scale(2.4); opacity: 0; }
	}

	/* ===== Ellipsis, the model's own work: three dots that part and gather.
	   Written so the RESTING style is the gathered point (a single fat mark) and the
	   keyframe travels outward from it, which is why an implicit from-frame is used: with
	   the animation off, what is left is that mark rather than a half-spread row of dots.
	   The reference for this shape animates width; this animates transform only, because
	   the row it sits in must never resize. ===== */
	.work--idle i {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 3.5px;
		height: 3.5px;
		margin: -1.75px 0 0 -1.75px;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		transform: scale(1.25);
		animation: work-idle-mid 1.1s ease-in-out infinite alternate;
	}

	.work--idle i:nth-child(1) { animation-name: work-idle-left; }
	.work--idle i:nth-child(3) { animation-name: work-idle-right; }

	@keyframes work-idle-left { to { transform: translateX(-4.5px) scale(0.95); } }
	@keyframes work-idle-mid { to { transform: scale(0.95); } }
	@keyframes work-idle-right { to { transform: translateX(4.5px) scale(0.95); } }

	/* Still frames. Most glyphs rest as their own pictogram; these four would rest as
	   nothing (a lone card, two stacked dots, a bare dot, an unstruck block), so they
	   get an explicit static pose instead. */
	.work--still i,
	.work--still b,
	.work--still em,
	.work--still path,
	.work--still rect,
	.work--still line {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.work i,
		.work b,
		.work em,
		.work path,
		.work rect,
		.work line {
			animation: none;
		}

		.work--sift i:nth-child(1) { transform: translate(3px, -2px) rotate(12deg); }
		.work--sift i:nth-child(3) { transform: translate(-3px, 2px) rotate(-10deg); }

		.work--bind i:nth-of-type(1) { offset-distance: 24%; }
		.work--bind i:nth-of-type(2) { offset-distance: 76%; }

		.work--go b { opacity: 0.55; transform: scale(2.1); }

		.work--look i { top: 6px; }
	}
</style>
