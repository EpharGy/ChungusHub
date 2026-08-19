<script lang="ts">
	import Dialog from './Dialog.svelte';
	import Button from './Button.svelte';

	interface Props {
		open: boolean;
		title?: string;
		label?: string;
		value?: string;
		placeholder?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		onConfirm: (value: string) => void;
		onCancel: () => void;
	}

	let {
		open,
		title = 'Enter a value',
		label,
		value = '',
		placeholder = '',
		confirmLabel = 'OK',
		cancelLabel = 'Cancel',
		onConfirm,
		onCancel
	}: Props = $props();

	// Seeded from `value` every time the dialog (re)opens, mirroring native
	// prompt(). Deliberately not $derived: the user edits it freely after.
	let inputValue = $state('');

	$effect(() => {
		if (open) inputValue = value;
	});

	function submit() {
		onConfirm(inputValue);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

<Dialog {open} onClose={onCancel} {title} size="sm">
	<div class="space-y-3">
		{#if label}
			<label for="prompt-dialog-input" class="block text-sm font-ui text-text-secondary">{label}</label>
		{/if}
		<input
			id="prompt-dialog-input"
			type="text"
			bind:value={inputValue}
			{placeholder}
			onkeydown={handleKeydown}
			onfocus={(e) => e.currentTarget.select()}
			class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
		/>
		<div class="flex gap-3 justify-end pt-1">
			<Button variant="ghost" onclick={onCancel}>{cancelLabel}</Button>
			<Button variant="primary" onclick={submit}>{confirmLabel}</Button>
		</div>
	</div>
</Dialog>
