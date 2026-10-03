<script lang="ts">
	/**
	 * What the composer menu's New chat does with the chat you are leaving: keep it, or delete
	 * it once the new one has started. Choosing nothing destructive here is a plain dialog,
	 * not a confirm; the delete choice hands off to the caller's ConfirmDialog, which states
	 * the real message count (the destructive-act ladder, architecture/ui-shell-settings.md).
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	interface Props {
		open: boolean;
		/** The chat being left, named in the question. */
		title: string;
		onNew: () => void;
		onNewAndDelete: () => void;
		onCancel: () => void;
	}

	let { open, title, onNew, onNewAndDelete, onCancel }: Props = $props();
</script>

<Dialog {open} onClose={onCancel} title="New chat" size="sm">
	<p class="new-lead">
		Start a new chat with this character. Keep <strong>{title}</strong>, or delete it once the
		new one has started?
	</p>

	<div class="new-actions">
		<Button variant="ghost" onclick={onCancel}>Cancel</Button>
		<Button variant="danger" onclick={onNewAndDelete}>New chat &amp; delete current</Button>
		<Button variant="primary" onclick={onNew}>New chat</Button>
	</div>
</Dialog>

<style>
	.new-lead {
		font-family: var(--font-ui);
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.new-lead strong {
		color: var(--color-text-primary);
	}

	/* Wraps rather than overflowing: the delete label is long, and a small dialog on a phone
	   cannot fit all three on one line. */
	.new-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.2rem;
	}
</style>
