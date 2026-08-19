<script lang="ts">
	// Single-line tag strip that adapts to its width: show as many whole chips as
	// fit, collapse the rest into a "+N" badge, and only truncate letters when even
	// one chip can't fit. Widths are measured from an off-screen mirror so the
	// decision is based on real rendered sizes, not a hardcoded chip count.
	interface Props {
		tags: string[];
	}
	let { tags }: Props = $props();

	const GAP = 4; // matches gap-1
	const CHIP_CLASS =
		'px-1.5 py-0.5 text-[10px] font-ui font-medium rounded-[var(--radius-sm)] bg-accent/10 text-accent';

	let container = $state<HTMLDivElement | null>(null);
	let measureLayer = $state<HTMLDivElement | null>(null);
	let containerW = $state(0);
	let chipWidths = $state<number[]>([]);
	let badgeW = $state(28);

	// Re-measure natural chip widths whenever the tag set changes.
	$effect(() => {
		tags;
		if (!measureLayer) return;
		const chips = Array.from(measureLayer.querySelectorAll('[data-chip]')) as HTMLElement[];
		chipWidths = chips.map((c) => Math.ceil(c.getBoundingClientRect().width));
		const badge = measureLayer.querySelector('[data-badge]') as HTMLElement | null;
		if (badge) badgeW = Math.ceil(badge.getBoundingClientRect().width);
	});

	$effect(() => {
		if (!container) return;
		const ro = new ResizeObserver((entries) => {
			containerW = entries[0].contentRect.width;
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	// Whole chips that fit. 0 means not even one fits. We then show a single
	// truncated chip.
	let fit = $derived.by(() => {
		if (!containerW || chipWidths.length === 0) return chipWidths.length || tags.length;
		const total = chipWidths.reduce((s, w, i) => s + w + (i > 0 ? GAP : 0), 0);
		if (total <= containerW) return chipWidths.length;
		let used = 0;
		let count = 0;
		for (let i = 0; i < chipWidths.length; i++) {
			const add = (count > 0 ? GAP : 0) + chipWidths[i];
			if (used + add + GAP + badgeW <= containerW) {
				used += add;
				count++;
			} else {
				break;
			}
		}
		return count;
	});

	let shown = $derived(fit === 0 ? 1 : fit);
	let hiddenCount = $derived(Math.max(0, tags.length - shown));
</script>

<div bind:this={container} class="flex items-center flex-nowrap gap-1 overflow-hidden">
	{#each tags.slice(0, shown) as tag}
		<span class="{CHIP_CLASS} {fit === 0 ? 'truncate min-w-0' : 'shrink-0 whitespace-nowrap'}">{tag}</span>
	{/each}
	{#if hiddenCount > 0}
		<span class="shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-ui text-text-muted">+{hiddenCount}</span>
	{/if}
</div>

<!-- Off-screen mirror used only to measure natural chip widths. -->
<div
	bind:this={measureLayer}
	aria-hidden="true"
	class="absolute -left-[9999px] top-0 flex flex-nowrap gap-1 invisible pointer-events-none"
>
	{#each tags as tag}
		<span data-chip class="{CHIP_CLASS} shrink-0 whitespace-nowrap">{tag}</span>
	{/each}
	<span data-badge class="shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-ui text-text-muted">+99</span>
</div>
