<script lang="ts">
	/**
	 * The dropdown the title bar's panel entries collapse into once there are more of them
	 * than fit as their own buttons.
	 *
	 * Only the popup lives here. The button that opens it stays in TitleBar, wearing
	 * `.overlay-btn` like every other button in that row: a trigger styled in here would be
	 * a second copy of the title bar's own button recipe, and a copy is what drifts. What
	 * this owns is the part that is genuinely not title-bar furniture: a floating menu,
	 * positioned against the trigger and dismissed the four ways a menu is dismissed.
	 *
	 * The mechanics are `LibraryEntryMenu`'s, deliberately: portal to `<body>`, measure the
	 * anchor after render so the real height is known, and close on outside press, Escape,
	 * scroll or resize. Following the app's existing menu rather than inventing a second one
	 * is the point: two menus that dismiss differently is a worse bug than either.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { FloatingPanelEntry } from '$lib/utils/floating-panels';

	interface Props {
		/** Every available panel, in title-bar order. Never empty: the caller does not render
		 *  a trigger with nothing behind it. */
		entries: FloatingPanelEntry[];
		/** The trigger, for positioning. Null only in the frame before it binds. */
		anchor: HTMLElement | null;
		onclose: () => void;
	}

	let { entries, anchor, onclose }: Props = $props();

	let menuEl = $state<HTMLDivElement | null>(null);
	let menuStyle = $state('');

	/** The title bar sits inside no transformed ancestor, so a fixed menu would position
	 *  correctly where it is. It is portalled anyway because the bar clips its own overflow
	 *  and is the app's drag region on desktop, and a menu is neither draggable nor clipped. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	// Position after render, so the measured height decides whether it opens downward or
	// flips above the trigger. The title bar is at the top of the screen, so downward is
	// nearly always right; the flip is what keeps it usable in a very short window.
	$effect(() => {
		if (!menuEl || !anchor) return;
		const rect = anchor.getBoundingClientRect();
		const height = menuEl.offsetHeight;
		const below = rect.bottom + 4;
		const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - height) : below;
		// Anchored on the trigger's left edge, clamped so a trigger near the right edge does
		// not push the menu off screen.
		const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuEl.offsetWidth - 8));
		menuStyle = `top: ${top}px; left: ${left}px;`;
	});

	function choose(entry: FloatingPanelEntry) {
		if (entry.disabled?.()) return;
		onclose();
		entry.toggle();
	}

	$effect(() => {
		const onPointerDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (menuEl?.contains(target) || anchor?.contains(target)) return;
			onclose();
		};
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			// Consume it, or the workspace's global Escape also closes whatever panel is
			// open behind the menu.
			e.preventDefault();
			e.stopPropagation();
			onclose();
		};
		document.addEventListener('mousedown', onPointerDown, true);
		window.addEventListener('scroll', onclose, true);
		window.addEventListener('resize', onclose);
		window.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('mousedown', onPointerDown, true);
			window.removeEventListener('scroll', onclose, true);
			window.removeEventListener('resize', onclose);
			window.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<!-- Hidden until the effect above has measured it, or the menu paints once at the top-left
     of the screen before jumping to the trigger. -->
<div
	bind:this={menuEl}
	use:portal
	role="menu"
	aria-label="Panels"
	class="fp-menu surface-float"
	style="{menuStyle || 'visibility: hidden;'} box-shadow: var(--shadow-md);"
>
	{#each entries as entry (entry.id)}
		{@const disabled = entry.disabled?.() ?? false}
		{@const open = entry.isOpen()}
		<button
			type="button"
			role="menuitem"
			class="fp-menu-item"
			class:is-open={open}
			aria-disabled={disabled ? true : undefined}
			title={entry.tooltip?.() ?? entry.label}
			onclick={() => choose(entry)}
		>
			<Icon name={entry.icon} class="w-3.5 h-3.5" />
			<span class="fp-menu-label">{entry.label}</span>
			{#if entry.badge?.() && !open}
				<!-- Same dot, same meaning, as the inline button carries: there is something in
				     here you have not seen. Aria-hidden because the tooltip already says it in
				     words, and a bare dot read aloud is noise. -->
				<span class="fp-menu-dot" aria-hidden="true"></span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.fp-menu {
		position: fixed;
		z-index: 100;
		min-width: 10rem;
		padding: 0.25rem 0;
		border-radius: var(--radius-lg);
	}

	.fp-menu-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.75rem;
		background: transparent;
		border: 0;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.fp-menu-item:hover:not([aria-disabled='true']) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	/* A panel already on screen reads the same here as its button does in the row. */
	.fp-menu-item.is-open {
		color: var(--color-accent);
	}

	.fp-menu-item[aria-disabled='true'] {
		opacity: 0.45;
		cursor: default;
	}

	.fp-menu-label {
		flex: 1;
		white-space: nowrap;
	}

	.fp-menu-dot {
		width: 0.32rem;
		height: 0.32rem;
		border-radius: 50%;
		background: var(--color-accent);
	}
</style>
