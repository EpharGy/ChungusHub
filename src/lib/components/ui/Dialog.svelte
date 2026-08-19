<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';

	type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

	const sizeClasses: Record<DialogSize, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-lg',
		xl: 'max-w-3xl'
	};

	interface Props {
		open: boolean;
		onClose: () => void;
		title?: string;
		size?: DialogSize;
		/** A dialog that must be answered rather than escaped: no close X, and Escape
		 *  and the backdrop stop dismissing. All three go together on purpose. Leaving
		 *  the X while blocking the key would leave a button on screen that does
		 *  nothing, which is the one thing a control is never allowed to be. Use it
		 *  only where closing would leave the app in a state it cannot work in. */
		dismissible?: boolean;
		children: Snippet;
	}

	let { open, onClose, title, size = 'md', dismissible = true, children }: Props = $props();

	/** The single door: every dismissal route runs through here, so `dismissible`
	 *  cannot be honoured by one of them and forgotten by another. */
	function requestClose(): void {
		if (dismissible) onClose();
	}

	const titleId = `dialog-title-${crypto.randomUUID()}`;
	let dialogEl: HTMLDivElement | null = $state(null);
	let portalEl: HTMLDivElement | null = $state(null);
	let previouslyFocused: HTMLElement | null = null;

	const focusableSelector =
		'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], summary';

	function getFocusableElements(): HTMLElement[] {
		if (!dialogEl) return [];
		return Array.from(dialogEl.querySelectorAll<HTMLElement>(focusableSelector)).filter(
			(el) => !el.hasAttribute('disabled') && el.offsetParent !== null
		);
	}

	function trapFocus(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;

		const focusable = getFocusableElements();
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// Portal: move dialog to body to escape stacking contexts (e.g., backdrop-filter)
	$effect(() => {
		if (open && portalEl) {
			document.body.appendChild(portalEl);
			previouslyFocused = document.activeElement as HTMLElement | null;
			// Double rAF ensures DOM is fully painted before focusing
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const focusable = getFocusableElements();
					if (focusable.length > 0) {
						focusable[0].focus();
					} else {
						dialogEl?.focus();
					}
				});
			});
		}

		return () => {
			if (portalEl && portalEl.parentNode === document.body) {
				document.body.removeChild(portalEl);
			}
			if (previouslyFocused) {
				previouslyFocused.focus();
				previouslyFocused = null;
			}
		};
	});

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			requestClose();
		}
	}

	function handleBackdropKeydown(e: KeyboardEvent) {
		// Allow Enter/Space on backdrop to close (keyboard equivalent of click)
		if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			requestClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			requestClose();
		}
		trapFocus(e);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
<div bind:this={portalEl} class="dialog-portal">
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-[300] flex items-start justify-center px-3 py-[4dvh] panel-scroll"
		style="background: var(--color-overlay); backdrop-filter: var(--backdrop-blur);"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? titleId : undefined}
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	>
		<!-- Dialog panel wrapper - non-scrolling container for close button -->
		<div
			class="dialog-panel surface-float relative w-full {sizeClasses[size]} mb-8 max-h-[90dvh] rounded-[var(--radius-xl)]"
			style="box-shadow: var(--shadow-lg);"
			transition:fly={{ y: 20, duration: 200 }}
		>
			<!-- Close button - outside scrollable area so it never disappears. Gone
			     entirely while the dialog must be answered, never shown inert. -->
			{#if dismissible}
				<button
					type="button"
					class="absolute top-3 right-3 icon-btn hover:bg-bg-tertiary z-10"
					onclick={onClose}
					aria-label="Close dialog"
				>
					<Icon name="close" class="w-5 h-5" />
				</button>
			{/if}

			<!-- Scrollable content area -->
			<div bind:this={dialogEl} class="panel-scroll overscroll-contain max-h-[90dvh]">
				{#if title}
					<div class="px-5 py-3 border-b border-border-subtle">
						<h2 id={titleId} class="text-lg font-ui font-semibold text-text-primary text-center">
							{title}
						</h2>
					</div>
				{/if}

				<div class="p-5">
					{@render children()}
				</div>
			</div>
		</div>
	</div>
</div>
{/if}

<style>
	@media (max-width: 700px) {
		.dialog-panel {
			max-width: 100% !important;
			max-height: 94vh !important;
			border-radius: var(--radius-lg);
		}
	}
</style>
