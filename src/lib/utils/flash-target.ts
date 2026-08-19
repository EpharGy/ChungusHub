/** Scroll an element into view and replay the app's accent ring/glow highlight. */
export function flashTarget(element: HTMLElement, block: ScrollLogicalPosition = 'center'): void {
	element.scrollIntoView({ behavior: 'smooth', block });
	element.animate(
		[
			{ boxShadow: '0 0 0 0 transparent' },
			{
				boxShadow:
					'0 0 0 3px var(--color-accent), 0 0 18px 2px color-mix(in srgb, var(--color-accent) 40%, transparent)'
			},
			{ boxShadow: '0 0 0 0 transparent' }
		],
		{ duration: 3000, easing: 'ease-out' }
	);
}
