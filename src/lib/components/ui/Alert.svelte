<script lang="ts">
	/**
	 * The in-place channel of the notification contract (the rules live in `stores/toast.svelte.ts`).
	 *
	 * A failure belongs where the act was: the dialog that raised it, the card that refused it.
	 * The toast stack cannot serve that job from inside a dialog, which is why half a dozen panels
	 * each grew a bare colored `<p>` of their own; this is the one shape they share.
	 *
	 * Absent message means nothing is wrong, and nothing is drawn: the alert costs no space until
	 * it has something to say, so a caller can leave it in the layout unconditionally.
	 */
	import Icon from './Icon.svelte';

	type AlertTone = 'error' | 'warning' | 'info';

	interface Props {
		message?: string | null;
		tone?: AlertTone;
	}

	let { message = null, tone = 'error' }: Props = $props();
</script>

{#if message}
	<p class="alert alert-{tone} font-ui" role="alert">
		<Icon name={tone === 'info' ? 'info' : 'warning'} class="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
		<span>{message}</span>
	</p>
{/if}

<style>
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.35;
	}

	/* The glyph sits on the first line of a message that wraps to several. */
	.alert :global(svg) {
		margin-top: 0.12rem;
	}

	.alert-error {
		color: var(--color-error);
	}

	.alert-warning {
		color: var(--color-warning);
	}

	.alert-info {
		color: var(--color-text-muted);
	}
</style>
