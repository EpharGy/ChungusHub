<script lang="ts">
	/**
	 * Renaming a sprite. Free text with a suggestion list: the vocabulary is SillyTavern's, so
	 * a hand-named sprite and an imported pack use the same words, but nothing is fixed and any
	 * label is legal.
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { SPRITE_LABEL_SUGGESTIONS, normalizeSpriteLabel } from '$lib/utils/sprites';

	interface Props {
		open: boolean;
		/** The label being edited. */
		label: string;
		/** Labels the character already uses, so a suggestion that would collide is muted. */
		taken: string[];
		onCommit: (label: string) => void;
		onCancel: () => void;
	}

	let { open, label, taken, onCommit, onCancel }: Props = $props();

	// Seeded every time the dialog reopens, the PromptDialog idiom. The user edits freely
	// after, so this is deliberately not $derived.
	let value = $state('');

	$effect(() => {
		if (open) value = label;
	});

	const takenKeys = $derived(new Set(taken.map((t) => t.toLowerCase())));
	const clean = $derived(normalizeSpriteLabel(value));
	const collides = $derived(clean !== '' && takenKeys.has(clean.toLowerCase()));

	function submit() {
		if (!clean || collides) return;
		onCommit(clean);
	}
</script>

<Dialog {open} onClose={onCancel} title="Rename this sprite" size="sm">
	<div class="space-y-3">
		<input
			type="text"
			bind:value
			placeholder="joy"
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					submit();
				}
			}}
			onfocus={(e) => e.currentTarget.select()}
			class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
		/>

		{#if collides}
			<p class="text-xs font-ui text-error">Another sprite is already “{clean}”.</p>
		{:else}
			<p class="text-xs font-ui text-text-muted">
				This is what the engine answers with to choose this sprite.
			</p>
		{/if}

		<div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
			{#each SPRITE_LABEL_SUGGESTIONS as suggestion (suggestion)}
				{@const used = takenKeys.has(suggestion)}
				<button
					type="button"
					disabled={used}
					onclick={() => (value = suggestion)}
					class="px-2 py-0.5 rounded-full border text-xs font-ui transition-colors {used
						? 'border-border-subtle text-text-muted opacity-45'
						: 'border-border text-text-secondary hover:border-accent hover:text-accent'}"
				>
					{suggestion}
				</button>
			{/each}
		</div>

		<div class="flex gap-3 justify-end pt-1">
			<Button variant="ghost" onclick={onCancel}>Cancel</Button>
			<Button variant="primary" onclick={submit} disabled={!clean || collides}>Save</Button>
		</div>
	</div>
</Dialog>
