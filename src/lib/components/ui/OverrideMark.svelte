<script lang="ts">
	/**
	 * The star beside a setting that has left the value it would otherwise inherit, and
	 * nothing at all while it matches. The ONE way the app marks this, so an inherited value
	 * reads the same in the lorebook and in steering.
	 *
	 * **It reads the difference, not the storage.** A field typed back to the inherited value
	 * is not a change, however it is stored, and a mark insisting otherwise sends the reader
	 * hunting for a difference that isn't on screen. Callers pass the comparison, never
	 * `value !== null`.
	 *
	 * One state, no chrome: a row that follows the defaults says nothing, which is what
	 * following them looks like. The star doubles as the way back, so the value that took the
	 * detour carries its own undo instead of leaving the reader to guess at one (empty this
	 * field, pick the option named "inherit" out of that list).
	 */
	interface Props {
		/** The value in force differs from the one this row would inherit. */
		overridden: boolean;
		/** Drop what this level stores so the row follows the default again. */
		onRevert: () => void;
	}

	let { overridden, onRevert }: Props = $props();
</script>

{#if overridden}
	<button
		type="button"
		class="ovr"
		onclick={onRevert}
		aria-label="Restore the default value"
		title="Changed from the default, click to put it back"
	>*</button>
{/if}

<style>
	.ovr {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		align-self: center;
		width: 0.75rem;
		font-family: var(--font-ui);
		font-size: 1rem;
		line-height: 1;
		color: var(--color-accent);
		cursor: pointer;
		/* The glyph sits at the top of its em box, so it needs pushing onto the row's line. */
		transform: translateY(0.2em);
		transition: opacity 130ms ease;
	}

	.ovr:hover {
		opacity: 0.65;
	}
</style>
