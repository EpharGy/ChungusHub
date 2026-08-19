<script lang="ts">
	/**
	 * The Memory nav button's own standing: its glyph, plus a mark in the button's corner.
	 *
	 * Chat memory does all of its work in the background (a pass after every assistant turn,
	 * another chasing a reap, a whole backlog ground down for minutes after enabling or a
	 * rebuild), and none of it is visible outside the panel. This is the button saying it.
	 *
	 * It owns the brain glyph rather than styling one the TitleBar rendered, so the whole
	 * indicator has one home: the thing that lights up and the thing that marks a backlog
	 * cannot drift apart into two files.
	 *
	 * Three visible states:
	 *
	 * - **Working**: the brain itself goes accent, lit, and breathes. It is the largest mark
	 *   the button has and the reader is already looking at it, which is exactly why the work
	 *   rides it: a separate progress rail at this size is too fine to read and says nothing
	 *   the glyph cannot. The breath is what makes a long silence legible, since a local model
	 *   can sit minutes inside one summary and a still button reads as a crash.
	 * - **Behind**: a static mark in the button's corner, no motion whatsoever. This is the
	 *   state with no other surface at all, and the one that can sit for the rest of a session:
	 *   in manual mode until the panel is asked to summarise, in automatic mode until the next reply, and
	 *   past `AUTO_MAX_BATCHES` for several replies either way. Anything that moved here would
	 *   move forever. It is also the one state the mark may stand for besides a failure: a
	 *   backlog is only worth flagging while nothing is being done about it, so a run in flight
	 *   must never wear it: that dot over a pass grinding the backlog down asks the reader to
	 *   go and look at the work that is already fixing itself.
	 * - **Error**: the same mark in the error colour. The store toasts a failure, but a toast
	 *   is gone in seconds and the reader who most needs it is the one who walked away from a
	 *   long build. The button is where that failure keeps standing.
	 *
	 * The number is the volume knob: below a couple of passes the indicator stays a bare pulse
	 * or a bare mark, because a pass that is over before it is read does not deserve a figure on
	 * screen, while a rebuild owing thirty is something the reader wants to watch come down,
	 * and once it is quoted it counts all the way down rather than blinking out mid-job (see
	 * `quoting`). The sentence itself lives in the button's tooltip (TitleBar), from the same
	 * derivation the panel's status row prints.
	 *
	 * The corner mark is `aria-hidden` and the glyph carries no text, so the fact rides the
	 * button's own `aria-label` in TitleBar. A hidden label *inside* the button would be worse
	 * than nothing below 1200px, where the visible "Memory" is dropped: the status text would
	 * then BE the button's whole accessible name and the button would lose its own.
	 */
	import type { ComponentProps } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { memoryStore } from '$lib/memory/store.svelte';

	/** Handed down rather than hardcoded, so the nav table stays the one place that says which
	 *  glyph this button wears. */
	let { icon }: { icon: ComponentProps<typeof Icon>['name'] } = $props();

	let standing = $derived(memoryStore.standing);

	/** Work above this many model calls is worth a number at all; at or below it the indicator
	 *  says only that something is happening. */
	const QUOTE_ABOVE = 2;

	/**
	 * The quote latches, and it has to. A bare threshold drops the figure the moment the work
	 * crosses back under it, so a three-call rebuild printed "3" and then lost the number
	 * outright on its first committed pass: the reader watched it disappear instead of counting
	 * down, which is the opposite of what a countdown is for. Once a job is big enough to be
	 * named it keeps its number to the end, and the latch releases only when there is nothing
	 * left to do.
	 *
	 * Reaching zero is also what carries it across a chat switch: `loadForChat` empties this
	 * state before the next chat's arrives, so the latch cannot follow one chat's backlog onto
	 * another, which matters because the store holds one chat at a time.
	 */
	let quoting = $state(false);
	$effect(() => {
		const n = standing.outstanding;
		if (n > QUOTE_ABOVE) quoting = true;
		else if (n === 0) quoting = false;
	});

	/** An error has no backlog to quote: the mark is the whole message. */
	let count = $derived(standing.kind !== 'error' && quoting ? standing.outstanding : 0);
</script>

<span class="mem-glyph" class:is-working={standing.kind === 'working'}>
	<Icon name={icon} class="w-3.5 h-3.5" />
</span>

<!-- One slot, one chain, and the order is the rule: the count takes the corner when there is
     one (a tinted figure is already a mark, and a better one), and otherwise the mark belongs
     to `behind` and `error` and to nothing else. Naming those two states rather than excluding
     `idle` is deliberate: a warning dot over a run that is actively closing the backlog reads
     as "look here, something is wrong" about the very work that is fixing it. -->
<span class="mem-status" aria-hidden="true">
	{#if count > 0}
		<span class="mem-count" class:is-behind={standing.kind === 'behind'}>{count}</span>
	{:else if standing.kind === 'behind' || standing.kind === 'error'}
		<span class="mem-mark" class:is-error={standing.kind === 'error'}></span>
	{/if}
</span>

<style>
	/* Exactly the box the bare icon occupied in the nav row, so the button's geometry does not
	   depend on what memory is doing: it never grows, the cluster never reorders, and neither
	   neighbour moves. */
	.mem-glyph {
		display: inline-flex;
		flex: 0 0 auto;
		color: inherit;
	}

	/* The glyph is the indicator. `color` reaches the icon through currentColor, and the glow
	   breathes with the opacity because both sit on this element: one moving thing, so
	   nothing else in the button plays while a pass is running. */
	.mem-glyph.is-working {
		color: var(--color-accent);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 55%, transparent));
		animation: mem-pulse 1.2s ease-in-out infinite alternate;
	}

	@keyframes mem-pulse {
		from {
			opacity: 0.6;
		}
		to {
			opacity: 1;
		}
	}

	/* Fills the button, takes part in none of its layout. */
	.mem-status {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.mem-mark {
		position: absolute;
		top: 0.2rem;
		right: 0.24rem;
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: var(--color-warning);
	}

	.mem-mark.is-error {
		background: var(--color-error);
	}

	/* Above the label's cap height and inside the button's own right padding, so it clears the
	   word at every width instead of sitting on it. */
	.mem-count {
		position: absolute;
		top: 0.06rem;
		right: 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.5rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--color-accent);
	}

	.mem-count.is-behind {
		color: var(--color-warning);
	}

	@media (prefers-reduced-motion: reduce) {
		/* The breath goes and what it leaves is the glyph lit at full strength, a frame that
		   still reads as working, which is the only kind of animation allowed here. */
		.mem-glyph.is-working {
			animation: none;
		}
	}
</style>
