<script lang="ts">
	import type { StoryMapNode } from '$lib/utils/story-map-layout';

	interface Props {
		nodes: StoryMapNode[];
		worldWidth: number;
		worldHeight: number;
		colW: number;
		rowH: number;
		pad: number;
		tx: number;
		ty: number;
		k: number;
		viewW: number;
		viewH: number;
		/** Center the main view on this world point (called continuously while dragging). */
		onNavigate: (wx: number, wy: number) => void;
	}

	let { nodes, worldWidth, worldHeight, colW, rowH, pad, tx, ty, k, viewW, viewH, onNavigate }: Props =
		$props();

	const W = 168;
	const H = 112;
	const P = 7;

	let s = $derived(Math.min((W - 2 * P) / worldWidth, (H - 2 * P) / worldHeight));
	let ox = $derived(P + (W - 2 * P - worldWidth * s) / 2);
	let oy = $derived(P + (H - 2 * P - worldHeight * s) / 2);

	const mx = (n: StoryMapNode) => ox + (n.col * colW + pad) * s;
	const my = (n: StoryMapNode) => oy + (n.depth * rowH + pad) * s;

	// The main viewport, projected into minimap space.
	let vx = $derived(ox + (-tx / k) * s);
	let vy = $derived(oy + (-ty / k) * s);
	let vw = $derived((viewW / k) * s);
	let vh = $derived((viewH / k) * s);

	let svgEl = $state<SVGSVGElement | undefined>(undefined);
	let dragging = false;

	function navigateFromEvent(e: PointerEvent) {
		if (!svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		onNavigate((e.clientX - rect.left - ox) / s, (e.clientY - rect.top - oy) / s);
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		dragging = true;
		svgEl?.setPointerCapture(e.pointerId);
		navigateFromEvent(e);
	}

	function onPointerMove(e: PointerEvent) {
		if (dragging) navigateFromEvent(e);
	}

	function onPointerUp(e: PointerEvent) {
		dragging = false;
		svgEl?.releasePointerCapture?.(e.pointerId);
	}
</script>

<!-- Pointer-only convenience: keyboard users pan with the arrow keys and fit with 0,
     so the overview stays out of the tab order. -->
<div class="minimap surface-float" aria-hidden="true">
	<svg
		bind:this={svgEl}
		role="presentation"
		width={W}
		height={H}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
	>
		{#each nodes as n (n.id)}
			<circle
				class="mini-dot"
				class:mini-dot--active={n.onActivePath}
				class:mini-dot--canon={n.onCanonPath}
				class:mini-dot--leaf={n.isActiveLeaf}
				cx={mx(n)}
				cy={my(n)}
				r={n.isActiveLeaf ? 3 : 2}
			/>
		{/each}
		<rect class="mini-view" x={vx} y={vy} width={Math.max(6, vw)} height={Math.max(6, vh)} rx="2" />
	</svg>
</div>

<style>
	.minimap {
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		overflow: hidden;
		line-height: 0;
	}

	.minimap svg {
		display: block;
		cursor: pointer;
		touch-action: none;
	}

	.mini-dot {
		fill: color-mix(in srgb, var(--color-text-muted) 55%, transparent);
	}

	.mini-dot--canon {
		fill: color-mix(in srgb, var(--color-warning) 80%, transparent);
	}

	.mini-dot--active {
		fill: var(--color-accent);
	}

	.mini-dot--leaf {
		stroke: var(--color-accent);
		stroke-width: 1.5;
		fill: color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.mini-view {
		fill: color-mix(in srgb, var(--color-accent) 10%, transparent);
		stroke: color-mix(in srgb, var(--color-accent) 75%, transparent);
		stroke-width: 1.2;
		pointer-events: none;
	}
</style>
