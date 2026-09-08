<script lang="ts">
	/**
	 * One control in a floating panel's header.
	 *
	 * The panels supply their own headers, so before this existed every panel carried its own
	 * copy of the same twelve lines of CSS: a 1.7rem square, transparent, muted, tinting on
	 * hover. Two copies were already byte-identical and neither knew about the other, which is
	 * the state a shared recipe exists to end rather than to tidy.
	 *
	 * It renders a glyph and nothing else, so `label` is the only name the control has: it is
	 * both the tooltip and the accessible name, and it is required for that reason. A header
	 * button with no label is a button a screen reader announces as "button".
	 *
	 * The standard glyphs are in `PANEL_ICONS`, and the hide control is not among the ones a
	 * panel draws: `FloatingWindow` renders that itself. See `architecture/floating-window.md`.
	 */
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		icon: IconName;
		/** Tooltip and accessible name, in one. Say what pressing it does, not what it is. */
		label: string;
		onclick: () => void;
		disabled?: boolean;
		/**
		 * Tint red on hover, for a control that destroys something.
		 *
		 * On hover only, deliberately: a header of permanently red buttons reads as a row of
		 * warnings, and the reader stops seeing any of them. The colour arrives at the moment
		 * it is about to matter.
		 */
		danger?: boolean;
	}

	let { icon, label, onclick, disabled = false, danger = false }: Props = $props();
</script>

<button
	type="button"
	class="fpb"
	class:fpb--danger={danger}
	{disabled}
	title={label}
	aria-label={label}
	{onclick}
>
	<Icon name={icon} class="w-4 h-4" strokeWidth={1.8} />
</button>

<style>
	.fpb {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.fpb:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.fpb--danger:hover:not(:disabled) {
		color: var(--color-error);
	}

	.fpb:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
