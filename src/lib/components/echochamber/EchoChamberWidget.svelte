<script lang="ts">
	import { onMount } from 'svelte';
	import { scale } from 'svelte/transition';

	import Icon from '$lib/components/ui/Icon.svelte';
	import ReactionFeed from './ReactionFeed.svelte';
	import { echoChamberStore } from '$lib/stores/echochamber.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';

	// EchoChamber as a floating widget, on the same terms as the Chungus Assistant: a
	// launcher button that animates open into a draggable, resizable panel, full-screen on
	// phones, with its rect remembered in localStorage.
	//
	// Floating rather than docked is the whole reason this port touches so little. The
	// workspace's side panels are mutually exclusive (uiStore.dropUnlockedSidePanels), and a
	// feed exists to be read WHILE the story is read, so docking it would have meant
	// teaching that choreography about a panel that never closes. The Assistant already
	// carved the exemption; this rides it.
	//
	// The drag/resize logic is deliberately a SIBLING of the Assistant's rather than a shared
	// shell extracted from it. Extracting would mean rewriting AssistantFloatingWidget, a 900
	// line file this port has no other reason to touch, and merge surface on an upstream file
	// is the cost this whole port is being shaped to avoid. The duplication is the price.

	const RECT_KEY = 'echochamber-widget-rect';
	const MIN_W = 280;
	const MIN_H = 300;
	const MARGIN = 16;

	let open = $derived(uiStore.echoChamberOpen);
	let isMobile = $derived(viewport.isMobile);
	let enabled = $derived(echoChamberStore.settings.enabled);

	let displayed = $derived(echoChamberStore.displayed);
	let feed = $derived(displayed?.feed ?? null);
	let messageId = $derived(echoChamberStore.currentMessageId);
	let busy = $derived(echoChamberStore.generatingFor !== null);
	let error = $derived(echoChamberStore.lastError);

	/** The feed on screen belongs to an earlier turn than the newest reply. True while a new
	 *  one is being written, and after deleting the newest turn's feed. Said out loud rather
	 *  than left to be inferred: stale reactions passed off as current is the one way keeping
	 *  the previous feed on screen can mislead. */
	let stale = $derived(displayed !== null && messageId !== null && displayed.messageId !== messageId);

	type Rect = { x: number; y: number; w: number; h: number };
	let rect = $state<Rect>({ x: 0, y: 0, w: 360, h: 520 });
	let rectReady = $state(false);

	function clampRect(r: Rect): Rect {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const w = Math.min(Math.max(r.w, MIN_W), vw - MARGIN * 2);
		const h = Math.min(Math.max(r.h, MIN_H), vh - MARGIN * 2);
		const x = Math.min(Math.max(r.x, MARGIN), vw - w - MARGIN);
		const y = Math.min(Math.max(r.y, MARGIN), vh - h - MARGIN);
		return { x, y, w, h };
	}

	function loadRect(): Rect {
		try {
			const raw = localStorage.getItem(RECT_KEY);
			if (raw) return clampRect(JSON.parse(raw) as Rect);
		} catch {
			/* unreadable or malformed, so fall through to the default placement */
		}
		const w = 360;
		const h = Math.min(520, window.innerHeight - MARGIN * 2);
		// Default to the LEFT of the screen: the Assistant's launcher and panel both favour
		// the right, and two floating panels opening on top of each other reads as a bug.
		return clampRect({ w, h, x: MARGIN, y: window.innerHeight - h - MARGIN });
	}

	function saveRect() {
		try {
			localStorage.setItem(RECT_KEY, JSON.stringify(rect));
		} catch {
			/* storage unavailable, so the position just will not persist */
		}
	}

	$effect(() => {
		if (open && !isMobile && !rectReady) {
			rect = loadRect();
			rectReady = true;
		}
		if (!open) rectReady = false;
	});

	onMount(() => {
		const onResize = () => {
			if (rectReady) rect = clampRect(rect);
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	// ---- Drag ----
	let dragging = $state(false);

	function startDrag(event: PointerEvent) {
		if (isMobile) return;
		const target = event.target as HTMLElement;
		// The header carries buttons; dragging from one of them would swallow its click.
		if (target.closest('button, select')) return;

		event.preventDefault();
		dragging = true;
		const startX = event.clientX;
		const startY = event.clientY;
		const origin = { ...rect };

		const move = (e: PointerEvent) => {
			rect = clampRect({
				...origin,
				x: origin.x + (e.clientX - startX),
				y: origin.y + (e.clientY - startY)
			});
		};
		const up = () => {
			dragging = false;
			saveRect();
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---- Resize ----
	type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

	function startResize(event: PointerEvent, edge: Edge) {
		if (isMobile) return;
		event.preventDefault();
		event.stopPropagation();

		const startX = event.clientX;
		const startY = event.clientY;
		const origin = { ...rect };

		const move = (e: PointerEvent) => {
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			let { x, y, w, h } = origin;

			// A west/north drag moves the origin as well as the size, and both have to be
			// clamped together or the panel walks across the screen at its minimum size.
			if (edge.includes('e')) w = origin.w + dx;
			if (edge.includes('s')) h = origin.h + dy;
			if (edge.includes('w')) {
				w = origin.w - dx;
				x = origin.x + dx;
			}
			if (edge.includes('n')) {
				h = origin.h - dy;
				y = origin.y + dy;
			}
			if (w < MIN_W && edge.includes('w')) x = origin.x + (origin.w - MIN_W);
			if (h < MIN_H && edge.includes('n')) y = origin.y + (origin.h - MIN_H);

			rect = clampRect({ x, y, w, h });
		};
		const up = () => {
			saveRect();
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---- Launcher drag ----
	// Mirrors the Assistant's launcher exactly: the closed button docks to the LEFT or RIGHT
	// edge (horizontal snaps to a side, never top or bottom) but slides freely up and down
	// that edge and stays where it is dropped. Side and vertical offset persist. A press that
	// never crosses the threshold is a plain click that opens the panel.
	const POS_KEY = 'echochamber-launcher-pos';
	const DRAG_THRESHOLD = 6;
	let launcherSide = $state<'left' | 'right'>('right');
	let launcherY = $state<number | null>(null); // persisted top px; null = default bottom anchor
	let launcherEl = $state<HTMLButtonElement | null>(null);
	let launcherDragX = $state<number | null>(null);
	let launcherDragY = $state<number | null>(null);
	let launcherDragging = $state(false);
	let launcherPointerDown = false;
	let suppressClick = false;
	let launcherGrab = { offsetX: 0, offsetY: 0, startX: 0, startY: 0 };

	let launcherStyle = $derived(
		launcherDragX !== null
			? `left:${launcherDragX}px; right:auto; top:${launcherDragY}px; bottom:auto;`
			: launcherY !== null
				? `top:${launcherY}px; bottom:auto;`
				: ''
	);

	function clampLauncherY(y: number): number {
		const h = launcherEl?.offsetHeight ?? 56;
		return Math.min(Math.max(y, MARGIN), window.innerHeight - h - MARGIN);
	}

	onMount(() => {
		try {
			const raw = localStorage.getItem(POS_KEY);
			if (raw) {
				const p = JSON.parse(raw) as { side?: string; y?: number };
				if (p.side === 'left' || p.side === 'right') launcherSide = p.side;
				if (typeof p.y === 'number') launcherY = clampLauncherY(p.y);
			}
		} catch {
			/* storage unavailable or malformed, so keep the default right dock */
		}
	});

	// Keep a dropped launcher on screen when the viewport shrinks.
	$effect(() => {
		const onResize = () => {
			if (launcherY !== null) launcherY = clampLauncherY(launcherY);
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	function onLauncherPointerDown(e: PointerEvent) {
		if (e.button && e.button !== 0) return; // primary button / touch only
		launcherPointerDown = true;
		launcherDragging = false;
		const r = launcherEl?.getBoundingClientRect();
		launcherGrab = {
			offsetX: r ? e.clientX - r.left : 0,
			offsetY: r ? e.clientY - r.top : 0,
			startX: e.clientX,
			startY: e.clientY
		};
		launcherEl?.setPointerCapture(e.pointerId);
	}

	function onLauncherPointerMove(e: PointerEvent) {
		if (!launcherPointerDown) return;
		if (
			!launcherDragging &&
			Math.abs(e.clientX - launcherGrab.startX) < DRAG_THRESHOLD &&
			Math.abs(e.clientY - launcherGrab.startY) < DRAG_THRESHOLD
		)
			return;
		launcherDragging = true;
		const w = launcherEl?.offsetWidth ?? 56;
		const h = launcherEl?.offsetHeight ?? 56;
		launcherDragX = Math.min(
			Math.max(e.clientX - launcherGrab.offsetX, MARGIN),
			window.innerWidth - w - MARGIN
		);
		launcherDragY = Math.min(
			Math.max(e.clientY - launcherGrab.offsetY, MARGIN),
			window.innerHeight - h - MARGIN
		);
	}

	function onLauncherPointerUp(e: PointerEvent) {
		if (!launcherPointerDown) return;
		launcherPointerDown = false;
		launcherEl?.releasePointerCapture(e.pointerId);
		if (launcherDragging) {
			const w = launcherEl?.offsetWidth ?? 56;
			const center = (launcherDragX ?? 0) + w / 2;
			launcherSide = center < window.innerWidth / 2 ? 'left' : 'right';
			launcherY = launcherDragY;
			try {
				localStorage.setItem(POS_KEY, JSON.stringify({ side: launcherSide, y: launcherY }));
			} catch {
				/* position just will not persist */
			}
			suppressClick = true; // swallow the click the browser fires after a drag
			// Touch drags usually fire NO trailing click, so without this reset the armed flag
			// would eat the NEXT genuine tap instead.
			setTimeout(() => (suppressClick = false), 350);
		}
		launcherDragX = null;
		launcherDragY = null;
		launcherDragging = false;
	}

	function onLauncherClick() {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		uiStore.echoChamberOpen = true;
	}

	function regenerate() {
		if (messageId) void echoChamberStore.regenerate(messageId);
	}

	/**
	 * Throw the current feed away.
	 *
	 * Deliberately does NOT regenerate afterwards. This exists for a feed that came out
	 * wrong, and a reader who wants a different one presses refresh; spending a call on
	 * their behalf here would make delete impossible to use as "stop showing me this".
	 *
	 * Nothing confirms it either: the feed is decoration, regenerating costs one call, and a
	 * dialog in front of a one-click undo is friction with nothing behind it.
	 */
	function forget() {
		// Deletes what is ON SCREEN, not the newest turn: those differ while a feed is being
		// written, and a delete button that removes something you cannot see is a trap.
		if (displayed) void echoChamberStore.forget(displayed.messageId);
	}
</script>

{#if enabled}
	{#if open}
		<section
			class="echo-panel"
			class:echo-panel--mobile={isMobile}
			class:echo-panel--dragging={dragging}
			style={isMobile
				? undefined
				: `left:${rect.x}px; top:${rect.y}px; width:${rect.w}px; height:${rect.h}px;`}
			transition:scale={{ duration: 140, start: 0.96 }}
			aria-label="EchoChamber"
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<header class="echo-header" onpointerdown={startDrag}>
				<Icon name="users" class="echo-header-icon" />
				<span class="echo-title">EchoChamber</span>

				<select
					class="echo-style"
					aria-label="Chat style"
					value={echoChamberStore.settings.styleId}
					onchange={(e) => echoChamberStore.update({ styleId: e.currentTarget.value })}
				>
					{#each echoChamberStore.styles as style (style.id)}
						<option value={style.id}>{style.name}</option>
					{/each}
				</select>

				{#if busy}
					<button class="echo-btn" onclick={() => echoChamberStore.cancel()} title="Stop">
						<Icon name="stop" />
					</button>
				{:else}
					<button
						class="echo-btn"
						onclick={regenerate}
						disabled={!messageId}
						title={messageId ? 'Generate reactions for the newest reply' : 'No reply to react to yet'}
					>
						<Icon name="refresh" />
					</button>
				{/if}

				<button
					class="echo-btn"
					onclick={forget}
					disabled={!feed || busy}
					title={feed
						? 'Delete these reactions. They stop being sent as history too.'
						: 'Nothing to delete'}
				>
					<Icon name="trash" />
				</button>

				<button
					class="echo-btn"
					onclick={() => (uiStore.echoChamberOpen = false)}
					title="Minimize"
				>
					<Icon name="minimize" />
				</button>
			</header>

			<div class="echo-content">
				{#if busy}
					<p class="echo-status">Listening to the crowd…</p>
				{:else if error}
					<p class="echo-status echo-status--error">{error}</p>
				{/if}

				{#if stale && feed}
					<p class="echo-status echo-status--stale">
						{busy ? 'Reactions to the previous reply' : 'From an earlier reply'}
					</p>
				{/if}

				<ReactionFeed
					reactions={feed?.reactions ?? []}
					emptyMessage={messageId
						? 'Nothing yet. Press refresh to hear what they think.'
						: 'Send a message first, then the crowd has something to react to.'}
				/>
			</div>

			{#if !isMobile}
				{#each EDGES as edge (edge)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="echo-resize echo-resize--{edge}"
						onpointerdown={(e) => startResize(e, edge)}
					></div>
				{/each}
			{/if}
		</section>
	{:else}
		<button
			type="button"
			bind:this={launcherEl}
			class="echo-launcher"
			class:launcher-left={launcherSide === 'left'}
			class:is-dragging={launcherDragging}
			style={launcherStyle}
			title={busy ? 'EchoChamber · listening…' : 'EchoChamber'}
			aria-label="Open EchoChamber"
			onpointerdown={onLauncherPointerDown}
			onpointermove={onLauncherPointerMove}
			onpointerup={onLauncherPointerUp}
			onclick={onLauncherClick}
			transition:scale={{ duration: 160, start: 0.6, opacity: 0 }}
		>
			<Icon name="users" />
			{#if busy}<span class="echo-launcher-pulse" aria-hidden="true"></span>{/if}
		</button>
	{/if}
{/if}

<style>
	.echo-panel {
		position: fixed;
		z-index: 200;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--color-bg-secondary) 94%, transparent);
		backdrop-filter: blur(10px);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}

	.echo-panel--dragging {
		user-select: none;
	}

	.echo-panel--mobile {
		inset: 0;
		border: none;
		border-radius: 0;
	}

	.echo-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.5rem;
		border-bottom: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		cursor: grab;
		touch-action: none;
	}
	.echo-panel--mobile .echo-header {
		cursor: default;
	}

	.echo-header :global(.echo-header-icon) {
		width: 1rem;
		height: 1rem;
		flex: 0 0 auto;
		color: var(--color-text-secondary);
	}

	.echo-title {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
	}

	.echo-style {
		flex: 1;
		min-width: 0;
		margin-left: 0.25rem;
		padding: 0.15rem 0.3rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.35rem;
		cursor: pointer;
	}

	.echo-btn {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: none;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-text-tertiary);
		cursor: pointer;
	}
	.echo-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-primary);
	}
	.echo-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.echo-btn :global(svg) {
		width: 0.95rem;
		height: 0.95rem;
	}

	.echo-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem 0.5rem 0.75rem;
	}

	.echo-status {
		margin: 0;
		padding: 0.5rem 0.25rem 0;
		font-size: 0.78rem;
		color: var(--color-text-tertiary);
	}
	.echo-status--error {
		color: var(--color-danger, #ef4444);
	}

	/* Quieter than the working line above it: this is a caption on the feed below, not an
	   event. Italic so it never reads as one of the reactions. */
	.echo-status--stale {
		font-size: 0.72rem;
		font-style: italic;
		opacity: 0.75;
	}

	/* ---- Resize handles ---- */
	.echo-resize {
		position: absolute;
		touch-action: none;
	}
	.echo-resize--n {
		top: -3px;
		left: 10px;
		right: 10px;
		height: 8px;
		cursor: ns-resize;
	}
	.echo-resize--s {
		bottom: -3px;
		left: 10px;
		right: 10px;
		height: 8px;
		cursor: ns-resize;
	}
	.echo-resize--e {
		right: -3px;
		top: 10px;
		bottom: 10px;
		width: 8px;
		cursor: ew-resize;
	}
	.echo-resize--w {
		left: -3px;
		top: 10px;
		bottom: 10px;
		width: 8px;
		cursor: ew-resize;
	}
	.echo-resize--ne {
		top: -4px;
		right: -4px;
		width: 14px;
		height: 14px;
		cursor: nesw-resize;
	}
	.echo-resize--nw {
		top: -4px;
		left: -4px;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
	}
	.echo-resize--se {
		bottom: -4px;
		right: -4px;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
	}
	.echo-resize--sw {
		bottom: -4px;
		left: -4px;
		width: 14px;
		height: 14px;
		cursor: nesw-resize;
	}

	/* ---- Launcher ----
	   Sized and behaved to match the Assistant's launcher exactly, because two floating
	   buttons of different sizes on one screen read as one being less important than the
	   other. The default anchor is stacked ABOVE the Assistant's corner so a fresh install
	   does not open with the two overlapping; from there it is dragged wherever. */
	.echo-launcher {
		position: fixed;
		right: 1.25rem;
		bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
		z-index: 200;
		width: 3.5rem;
		height: 3.5rem;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-subtle);
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-bg-secondary) 92%, transparent);
		color: var(--color-text-secondary);
		box-shadow: var(--shadow-lg);
		cursor: pointer;
		overflow: visible;
		/* Horizontal drag must not scroll the page under the finger on touch. */
		touch-action: none;
		transition:
			transform 140ms ease,
			box-shadow 140ms ease;
	}

	/* Docked to the left corner instead of the default right. */
	.echo-launcher.launcher-left {
		left: 1.25rem;
		right: auto;
	}

	.echo-launcher:hover {
		color: var(--color-text-primary);
		transform: translateY(-2px) scale(1.04);
		box-shadow: var(--shadow-glow);
	}

	/* While dragging, freeze the hover lift and animation so it tracks the pointer 1:1. */
	.echo-launcher.is-dragging,
	.echo-launcher.is-dragging:hover {
		transform: none;
		cursor: grabbing;
		transition: none;
	}

	.echo-launcher :global(svg) {
		width: 1.4rem;
		height: 1.4rem;
	}

	/* Phone (the same 640px break as viewport.isMobile): clear of the full-width composer,
	   and clear of the Assistant's own raised position down there. */
	@media (max-width: 640px) {
		.echo-launcher {
			right: 0.75rem;
			bottom: calc(13.5rem + env(safe-area-inset-bottom, 0px));
			width: 3rem;
			height: 3rem;
		}
		.echo-launcher.launcher-left {
			left: 0.75rem;
			right: auto;
		}
	}

	.echo-launcher-pulse {
		position: absolute;
		inset: -3px;
		border-radius: 50%;
		border: 2px solid var(--color-accent, #ec4899);
		animation: echo-pulse 1.4s ease-out infinite;
	}

	@keyframes echo-pulse {
		0% {
			opacity: 0.8;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(1.25);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.echo-launcher-pulse {
			animation: none;
			opacity: 0.5;
		}
	}
</style>
