<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onGenerate: (input: string) => void;
		isGenerating?: boolean;
	}

	let { open, onClose, onGenerate, isGenerating = false }: Props = $props();

	type SceneType = 'random' | 'custom' | null;
	let selectedType = $state<SceneType>(null);
	let customScenario = $state('');

	function handleGenerate() {
		if (!selectedType) return;
		const input = selectedType === 'random' ? 'Random' : customScenario.trim();
		if (selectedType === 'custom' && !input) return;
		onGenerate(input);
	}

	function handleClose() {
		// Reset state when closing
		selectedType = null;
		customScenario = '';
		onClose();
	}

	function selectType(type: SceneType) {
		selectedType = type;
		if (type === 'random') {
			customScenario = '';
		}
	}

	$effect(() => {
		if (!open) {
			selectedType = null;
			customScenario = '';
		}
	});
</script>

<Dialog {open} onClose={handleClose} title="Generate opening scene" size="md">
	<div class="space-y-5">
		<p class="text-text-muted text-sm font-body">
			Choose how you'd like to start your story. The AI will craft an opening scene based on your
			characters, lorebook, and settings.
		</p>

		<!-- Option Cards -->
		<div class="grid grid-cols-2 gap-3">
			<!-- Random Option -->
			<button
				type="button"
				class="p-4 rounded-[var(--radius-lg)] border-2 transition-all text-left
					{selectedType === 'random'
					? 'border-accent bg-accent/10'
					: 'border-border hover:border-border-hover bg-bg-secondary'}"
				onclick={() => selectType('random')}
				disabled={isGenerating}
			>
				<div class="flex items-center gap-2 mb-2">
					<Icon name="refresh" class="w-5 h-5 text-accent" />
					<span class="font-ui font-semibold text-text-primary">Random</span>
				</div>
				<p class="text-text-muted text-xs font-body">
					Let the AI surprise you with a compelling scenario
				</p>
			</button>

			<!-- Custom Option -->
			<button
				type="button"
				class="p-4 rounded-[var(--radius-lg)] border-2 transition-all text-left
					{selectedType === 'custom'
					? 'border-accent bg-accent/10'
					: 'border-border hover:border-border-hover bg-bg-secondary'}"
				onclick={() => selectType('custom')}
				disabled={isGenerating}
			>
				<div class="flex items-center gap-2 mb-2">
					<Icon name="edit" class="w-5 h-5 text-accent" />
					<span class="font-ui font-semibold text-text-primary">Custom</span>
				</div>
				<p class="text-text-muted text-xs font-body">Describe your desired opening scenario</p>
			</button>
		</div>

		<!-- Custom Scenario Textarea -->
		{#if selectedType === 'custom'}
			<div class="space-y-2">
				<label for="custom-scenario" class="block text-sm font-ui font-medium text-text-primary">
					Describe your scenario
				</label>
				<textarea
					id="custom-scenario"
					bind:value={customScenario}
					placeholder="e.g. the protagonist wakes up in an unfamiliar room…"
					class="w-full h-28 px-3 py-2 bg-bg-secondary border border-border rounded-[var(--radius-md)]
						text-text-primary font-body text-sm placeholder:text-text-muted
						focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
						resize-none"
					disabled={isGenerating}
				></textarea>
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex justify-end gap-3 pt-2">
			<Button variant="ghost" onclick={handleClose} disabled={isGenerating}>Cancel</Button>
			<Button
				variant="primary"
				onclick={handleGenerate}
				disabled={isGenerating || !selectedType || (selectedType === 'custom' && !customScenario.trim())}
			>
				{#if isGenerating}
					<Icon name="refresh" class="w-4 h-4 animate-spin" />
					Generating…
				{:else}
					<Icon name="bookOpen" class="w-4 h-4" />
					Generate
				{/if}
			</Button>
		</div>
	</div>
</Dialog>
