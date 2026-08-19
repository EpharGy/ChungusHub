/**
 * Svelte action: focus management for hand-rolled overlays, the same behaviour
 * ui/Dialog.svelte implements internally (initial focus, Tab trap, restore on
 * close) for modals that can't be built on Dialog.
 *
 * Usage: <div use:focusTrap>                    (modal: traps Tab inside)
 *        <div use:focusTrap={{ trap: false }}>  (non-modal: focus + restore only)
 */

interface FocusTrapOptions {
	/** Keep Tab cycling inside the node. Default true; turn off for non-modal floats. */
	trap?: boolean;
}

const FOCUSABLE_SELECTOR =
	'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], summary';

export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}) {
	const trap = options.trap ?? true;
	const previouslyFocused = document.activeElement as HTMLElement | null;

	function getFocusableElements(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(el) => !el.hasAttribute('disabled') && el.offsetParent !== null
		);
	}

	function handleKeydown(e: KeyboardEvent) {
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

	// Double rAF ensures the DOM is fully painted before focusing (same as Dialog).
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const focusable = getFocusableElements();
			if (focusable.length > 0) focusable[0].focus();
			else node.focus();
		});
	});

	if (trap) window.addEventListener('keydown', handleKeydown);

	return {
		destroy() {
			if (trap) window.removeEventListener('keydown', handleKeydown);
			// Restore only if focus is still ours to give back: a non-modal card must
			// not yank focus away if the user has since moved on (e.g. to the composer).
			const active = document.activeElement;
			if (previouslyFocused && (node.contains(active) || active === document.body || active === null)) {
				previouslyFocused.focus();
			}
		}
	};
}
