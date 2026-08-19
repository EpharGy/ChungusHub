<script lang="ts">
	/**
	 * When in the day the reader writes: twenty four bars, midnight to midnight.
	 *
	 * Bars are scaled against the busiest hour rather than the total, because the shape is
	 * the point and a share-of-everything scale flattens all of it into the bottom tenth.
	 * The quiet hours stay on screen as empty bars: an hour nobody writes in is part of the
	 * shape, and dropping it would slide the whole day sideways.
	 */
	import { hourLabel, plural } from '$lib/stats/format';

	let { hours, prime }: { hours: number[]; prime: [number, number] | null } = $props();

	let peak = $derived(Math.max(1, ...hours));

	/** Whether an hour sits inside the prime window, which wraps around midnight. */
	function inPrime(hour: number): boolean {
		if (!prime) return false;
		const [from, to] = prime;
		return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
	}
</script>

<div class="clock">
	<div class="bars">
		{#each hours as value, hour (hour)}
			<div
				class="slot"
				class:is-prime={inPrime(hour)}
				title="{plural(value, 'message')} at {hourLabel(hour)}"
			>
				<div class="bar" style="height: {Math.max(value > 0 ? 6 : 2, (value / peak) * 100)}%"></div>
			</div>
		{/each}
	</div>
	<div class="ticks" aria-hidden="true">
		<span>00:00</span>
		<span>06:00</span>
		<span>12:00</span>
		<span>18:00</span>
		<span>24:00</span>
	</div>
</div>

<style>
	.clock {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.bars {
		display: flex;
		align-items: flex-end;
		gap: 0.15rem;
		height: 4.5rem;
	}

	.slot {
		flex: 1;
		display: flex;
		align-items: flex-end;
		height: 100%;
	}

	.bar {
		width: 100%;
		border-radius: 2px 2px 0 0;
		background: color-mix(in oklab, var(--color-accent) 30%, var(--color-bg-tertiary));
	}

	/* The window that holds half of everything, lit so the habit reads at a glance. */
	.slot.is-prime .bar {
		background: var(--color-accent);
	}

	.ticks {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		color: var(--color-text-muted);
	}
</style>
