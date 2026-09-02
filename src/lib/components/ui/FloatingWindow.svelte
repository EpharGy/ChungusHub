<script lang="ts">
	/**
	 * A draggable, resizable, dockable panel: the Chungus Assistant's floating shell, made
	 * reusable. The caller supplies a header row and a body; everything about where the
	 * window sits, how it is moved and how that survives a reload lives here.
	 *
	 * Docking reads the app's own layout anchors (`[data-assistant-snap-workspace]` and
	 * `[data-assistant-snap-column]`, placed by Workspace and TitleBar) rather than
	 * recomputing the responsive CSS, so a docked window tracks the chat column through
	 * zoom, a width change and a breakpoint flip for free. Those anchors belong to the
	 * Assistant, not to this component, so a missing one **fails soft**: the window stays
	 * free-floating instead of throwing. A borrowed DOM contract is not worth a crash.
	 *
	 * The geometry itself is in `$lib/utils/floating-window`, pure and unit-tested.
	 *
	 * **Desktop only.** There is deliberately no phone layout: a floating window needs a
	 * launcher to come back from, and a third launcher on a phone screen is clutter with no
	 * home. Callers hide their own entry point on mobile; this renders nothing there, so a
	 * window can never be stranded off-screen with no way back.
	 */
	import type { Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { viewport } from '$lib/stores/viewport.svelte';
	import {
		DRAG_THRESHOLD,
		centeredRect,
		clampRect,
		readPlacement,
		snapRegion,
		snapZoneFor,
		writePlacement,
		type Rect,
		type Size,
		type SnapAnchors,
		type SnapZone
	} from '$lib/utils/floating-window';

	interface Props {
		open: boolean;
		/** localStorage key the placement persists under. One per window kind. */
		storageKey: string;
		/** Floor for a free-floating resize. A dock ignores it: a slot has its own size. */
		minSize?: Size;
		/** Opening size when nothing has been saved yet. */
		defaultSize?: Size;
		ariaLabel: string;
		/** The drag handle. Buttons inside it still click: a press that starts on one is
		 *  never a drag. */
		header: Snippet;
		children: Snippet;
	}

	let {
		open,
		storageKey,
		minSize = { w: 280, h: 240 },
		defaultSize = { w: 480, h: 520 },
		ariaLabel,
		header,
		children
	}: Props = $props();

	let isMobile = $derived(viewport.isMobile);

	/** A seed, never a placement. The restore effect below computes the real rectangle from
	 *  `defaultSize` (or the saved one) the first time the window opens, and it is literals
	 *  here rather than `defaultSize` because reading a prop at initialisation captures only
	 *  its first value, which is the shape of a bug even where nothing changes it. */
	let rect = $state<Rect>({ x: 0, y: 0, w: 480, h: 520 });
	let rectReady = $state(false);
	let isSnapped = $state(false);
	let snappedZone = $state<SnapZone | null>(null);
	let snapTarget = $state<Rect | null>(null);
	let pendingZone: SnapZone | null = null;
	/** The floating size a docked window returns to when torn off, so it follows the cursor
	 *  at its old dimensions instead of dragging an entire dock around. */
	let restoreSize: Size | null = null;

	function viewportSize(): Size {
		return { w: window.innerWidth, h: window.innerHeight };
	}

	function fit(r: Rect): Rect {
		return clampRect(r, minSize, viewportSize());
	}

	function snapAnchors(): SnapAnchors | null {
		const workspaceEl = document.querySelector<HTMLElement>('[data-assistant-snap-workspace]');
		const columnEl = document.querySelector<HTMLElement>('[data-assistant-snap-column]');
		if (!workspaceEl || !columnEl) return null;
		const workspace = workspaceEl.getBoundingClientRect();
		const column = columnEl.getBoundingClientRect();
		return {
			workspace: { x: workspace.left, y: workspace.top, w: workspace.width, h: workspace.height },
			column: { x: column.left, y: column.top, w: column.width, h: column.height }
		};
	}

	function regionFor(zone: SnapZone): Rect | null {
		const anchors = snapAnchors();
		return anchors ? snapRegion(zone, anchors, viewport.canDockSettings) : null;
	}

	function save() {
		writePlacement(storageKey, {
			...rect,
			snappedZone: isSnapped ? snappedZone : null,
			...(restoreSize ? { freeW: restoreSize.w, freeH: restoreSize.h } : {})
		});
	}

	// Restore the placement the first time the window opens, INCLUDING its dock: reopening
	// must not demote a docked window to a free one wearing the dock's size.
	$effect(() => {
		if (open && !isMobile && !rectReady) {
			const saved = readPlacement(storageKey);
			rect = saved ? fit(saved) : centeredRect(defaultSize, minSize, viewportSize());
			restoreSize =
				saved && saved.freeW !== undefined && saved.freeH !== undefined
					? { w: saved.freeW, h: saved.freeH }
					: null;
			isSnapped = false;
			snappedZone = null;
			if (saved?.snappedZone) {
				const region = regionFor(saved.snappedZone);
				if (region) {
					snappedZone = saved.snappedZone;
					isSnapped = true;
					rect = region;
				}
			}
			rectReady = true;
		}
		if (!open) rectReady = false;
	});

	/** Re-fit on any layout change. A docked rectangle deliberately skips the viewport clamp,
	 *  so the floating minimums can never push a dock off its own boundaries. */
	function refitToLayout() {
		if (!rectReady) return;
		if (isSnapped && snappedZone) {
			const region = regionFor(snappedZone);
			if (region) rect = region;
			else {
				// The anchors went away. Fall back to floating rather than freeze in a dock
				// whose geometry can no longer be recomputed.
				isSnapped = false;
				snappedZone = null;
				rect = fit(rect);
			}
		} else {
			rect = fit(rect);
		}
		if (snapTarget && pendingZone) snapTarget = regionFor(pendingZone);
	}

	$effect(() => {
		if (!open || isMobile) return;
		window.addEventListener('resize', refitToLayout);
		const anchors = [
			document.querySelector<HTMLElement>('[data-assistant-snap-workspace]'),
			document.querySelector<HTMLElement>('[data-assistant-snap-column]')
		].filter((el): el is HTMLElement => el !== null);
		const observer = new ResizeObserver(refitToLayout);
		for (const el of anchors) observer.observe(el);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', refitToLayout);
		};
	});

	// The docking breakpoint changes what "left" and "right" mean, so a docked window has to
	// be re-measured when it flips, not only when something resizes.
	$effect(() => {
		viewport.canDockSettings;
		if (open && !isMobile && isSnapped && snappedZone) refitToLayout();
	});

	// ---- Drag (by the header) ----
	let dragging = $state(false);
	let dragStart = { px: 0, py: 0, x: 0, y: 0 };
	/** A header press only becomes a drag past the threshold, so a plain click on a docked
	 *  window's header never tears it out of its dock. */
	let headerMoved = false;

	function onHeaderPointerDown(e: PointerEvent) {
		if (isMobile) return;
		// The header carries buttons; dragging from one would swallow its click.
		if ((e.target as HTMLElement).closest('button, a, select, input')) return;
		dragging = true;
		headerMoved = false;
		dragStart = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onHeaderPointerMove(e: PointerEvent) {
		if (!dragging) return;
		if (!headerMoved) {
			if (
				Math.abs(e.clientX - dragStart.px) < DRAG_THRESHOLD &&
				Math.abs(e.clientY - dragStart.py) < DRAG_THRESHOLD
			) {
				return;
			}
			headerMoved = true;
			// First real movement tears a docked window off: it returns to its free size,
			// dropped under the cursor with the grab point kept on the header.
			if (isSnapped && restoreSize) {
				const relX = rect.w > 0 ? (e.clientX - rect.x) / rect.w : 0.5;
				const grabY = Math.min(Math.max(e.clientY - rect.y, 0), 32);
				rect = fit({
					w: restoreSize.w,
					h: restoreSize.h,
					x: e.clientX - relX * restoreSize.w,
					y: e.clientY - grabY
				});
				isSnapped = false;
				snappedZone = null;
				dragStart = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y };
			}
		}
		// Follow the cursor with NO clamp, so the header can actually reach an edge or a
		// corner. The window may hang off-screen mid-drag; release pulls it back or docks it.
		rect = {
			...rect,
			x: dragStart.x + (e.clientX - dragStart.px),
			y: dragStart.y + (e.clientY - dragStart.py)
		};
		const zone = snapZoneFor(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
		pendingZone = zone;
		snapTarget = zone ? regionFor(zone) : null;
	}

	function onHeaderPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		if (!headerMoved) return; // a plain click: nothing moved, nothing to re-place
		if (snapTarget) {
			// Remember the free size, but only on the free to docked transition, or a second
			// dock would record the first dock's dimensions as "free".
			if (!isSnapped) restoreSize = { w: rect.w, h: rect.h };
			rect = snapTarget;
			isSnapped = true;
			snappedZone = pendingZone;
		} else {
			rect = fit(rect); // a free drop: pull it fully back on screen
			isSnapped = false;
			snappedZone = null;
		}
		snapTarget = null;
		pendingZone = null;
		save();
	}

	// ---- Resize (edges + corners) ----
	const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
	let resizing: string | null = null;
	let resizeStart = { px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 };

	function onResizePointerDown(e: PointerEvent, dir: string) {
		if (isMobile) return;
		e.stopPropagation();
		resizing = dir;
		resizeStart = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onResizePointerMove(e: PointerEvent) {
		if (!resizing) return;
		const dx = e.clientX - resizeStart.px;
		const dy = e.clientY - resizeStart.py;
		// Resizing a docked window frees it, on the first real movement rather than on the
		// press, so a stray click on an edge cannot undock it. It has to leave: the layout
		// anchors would re-fit a hand-sized rectangle straight back to the slot.
		if (isSnapped && (dx !== 0 || dy !== 0)) {
			isSnapped = false;
			snappedZone = null;
		}
		let { x, y, w, h } = resizeStart;
		if (resizing.includes('e')) w = resizeStart.w + dx;
		if (resizing.includes('s')) h = resizeStart.h + dy;
		if (resizing.includes('w')) {
			w = resizeStart.w - dx;
			x = resizeStart.x + dx;
		}
		if (resizing.includes('n')) {
			h = resizeStart.h - dy;
			y = resizeStart.y + dy;
		}
		// Enforce the minimum by pinning the anchored edge, or the window walks across the
		// screen at its minimum size instead of stopping.
		if (w < minSize.w && resizing.includes('w')) x = resizeStart.x + resizeStart.w - minSize.w;
		if (h < minSize.h && resizing.includes('n')) y = resizeStart.y + resizeStart.h - minSize.h;
		rect = fit({ x, y, w, h });
	}

	function onResizePointerUp(e: PointerEvent) {
		if (!resizing) return;
		resizing = null;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		save();
	}

	let frameStyle = $derived(
		`left:${rect.x}px; top:${rect.y}px; width:${rect.w}px; height:${rect.h}px;`
	);
</script>

{#if open && !isMobile}
	{#if snapTarget}
		<!-- The ghost region the window will jump to on release. -->
		<div
			class="fw-snap-ghost"
			style="left:{snapTarget.x}px; top:{snapTarget.y}px; width:{snapTarget.w}px; height:{snapTarget.h}px;"
		></div>
	{/if}
	<section
		class="fw surface-float"
		class:fw--snapped={isSnapped}
		class:fw--snap-left={isSnapped && snappedZone === 'left'}
		class:fw--snap-right={isSnapped && snappedZone === 'right'}
		class:fw--snap-center={isSnapped && snappedZone === 'center'}
		class:fw--snap-top-half={isSnapped && (snappedZone === 'tl' || snappedZone === 'tr')}
		class:fw--snap-bottom-half={isSnapped && (snappedZone === 'bl' || snappedZone === 'br')}
		style={frameStyle}
		aria-label={ariaLabel}
		data-panel
		transition:scale={{ duration: 160, start: 0.94, opacity: 0 }}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<header
			class="fw-header"
			class:fw-header--dragging={dragging}
			onpointerdown={onHeaderPointerDown}
			onpointermove={onHeaderPointerMove}
			onpointerup={onHeaderPointerUp}
		>
			{@render header()}
		</header>

		<div class="fw-body">
			{@render children()}
		</div>

		{#each HANDLES as dir (dir)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fw-resize fw-resize--{dir}"
				onpointerdown={(e) => onResizePointerDown(e, dir)}
				onpointermove={onResizePointerMove}
				onpointerup={onResizePointerUp}
			></div>
		{/each}
	</section>
{/if}

<style>
	/* Frost comes from .surface-float in the markup, like the Assistant's own panel. */
	.fw {
		position: fixed;
		/* The Assistant's tier. Above the workspace's isolated stacking context, below the
		   lightbox at 300, so a full-screen viewer opened afterwards still lands on top. */
		z-index: 200;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}

	/* A docked window uses the same flush surface and seams as the workspace's own docks.
	   Floating-only radius, shadow and all-edge glass border stay off. */
	.fw--snapped {
		border: 0;
		border-radius: 0;
		box-shadow: none;
		background: var(--theme-panel-bg, color-mix(in srgb, var(--color-bg-primary) 58%, transparent));
		backdrop-filter: var(--backdrop-blur);
		-webkit-backdrop-filter: var(--backdrop-blur);
	}

	.fw--snap-left {
		border-right: 1px solid var(--color-border-subtle);
	}

	.fw--snap-right {
		border-left: 1px solid var(--color-border-subtle);
	}

	.fw--snap-center {
		border-left: 1px solid var(--color-border-subtle);
		border-right: 1px solid var(--color-border-subtle);
	}

	.fw--snap-top-half {
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.fw--snap-bottom-half {
		border-top: 1px solid var(--color-border-subtle);
	}

	/* Snap preview: glides between zones as the cursor moves near the edges. */
	.fw-snap-ghost {
		position: fixed;
		z-index: 199;
		border: 2px solid var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		pointer-events: none;
		transition:
			left 90ms ease,
			top 90ms ease,
			width 90ms ease,
			height 90ms ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.fw-snap-ghost {
			transition: none;
		}
	}

	.fw-header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.4rem;
		padding: 0 0.35rem 0 0.6rem;
		border-bottom: 1px solid var(--color-border-subtle);
		cursor: grab;
		/* The header owns the pointer during a drag; without this a touch drag scrolls. */
		touch-action: none;
		user-select: none;
	}

	.fw-header--dragging {
		cursor: grabbing;
	}

	.fw-body {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	/* ---- Resize handles ---- */
	.fw-resize {
		position: absolute;
		touch-action: none;
	}
	.fw-resize--n {
		top: -3px;
		left: 10px;
		right: 10px;
		height: 8px;
		cursor: ns-resize;
	}
	.fw-resize--s {
		bottom: -3px;
		left: 10px;
		right: 10px;
		height: 8px;
		cursor: ns-resize;
	}
	.fw-resize--e {
		right: -3px;
		top: 10px;
		bottom: 10px;
		width: 8px;
		cursor: ew-resize;
	}
	.fw-resize--w {
		left: -3px;
		top: 10px;
		bottom: 10px;
		width: 8px;
		cursor: ew-resize;
	}
	.fw-resize--ne {
		top: -4px;
		right: -4px;
		width: 14px;
		height: 14px;
		cursor: nesw-resize;
	}
	.fw-resize--nw {
		top: -4px;
		left: -4px;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
	}
	.fw-resize--se {
		bottom: -4px;
		right: -4px;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
	}
	.fw-resize--sw {
		bottom: -4px;
		left: -4px;
		width: 14px;
		height: 14px;
		cursor: nesw-resize;
	}
</style>
