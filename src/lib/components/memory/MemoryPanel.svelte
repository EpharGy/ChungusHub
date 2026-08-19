<script lang="ts">
	/**
	 * Memory panel, the chat-area overlay `memory`: the per-chat memory surface.
	 * Owns the shared stacked header (the open chat's name, purely an indicator of
	 * what the body acts on) and the per-chat switch beside it. The switch only
	 * renders the control; the enable flow with its cost confirm stays in MemoryView
	 * (`requestToggle`), which the intro's own enable button shares. The body is
	 * MemoryView (the episode timeline).
	 *
	 * The TitleBar drops this panel's button while the memory engine is globally
	 * off, so the off-note below is only reachable when another device flips the
	 * switch while the panel is already open.
	 */
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import MemoryView from '$lib/components/memory/MemoryView.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
	import { memoryStore } from '$lib/memory/store.svelte';

	let chat = $derived(chatStore.currentChatState?.chat ?? null);
	let memoryView = $state<MemoryView | null>(null);

	// The one door out of the off-note below, landing on the memory engine's own detail
	// page. gotoSettingsPage, not a raw settingsPage write: it is the only thing that clears
	// settingsEngineId, so a bare assignment would re-open whichever engine detail the user
	// last drilled into.
	function openMemorySettings() {
		uiStore.gotoSettingsPage('engines');
		uiStore.settingsEngineId = 'memory';
		uiStore.openSettings();
	}
</script>

<div class="memory-panel">
	<header class="overlay-header overlay-header--stacked">
		<h2 class="overlay-title">Memory</h2>
		<!-- The switch is about the chat the line names, so it rides it. -->
		<div class="overlay-crumb">
			{#if chat}
				<span class="overlay-subject">{chat.title}</span>
				{#if featurePromptsStore.memoryEnabled}
					<span
						class="mp-toggle"
						title={memoryStore.enabled
							? 'Disable memory for this chat'
							: 'Enable memory for this chat'}
					>
						<Toggle
							size="sm"
							checked={memoryStore.enabled}
							onchange={() => void memoryView?.requestToggle()}
							label={memoryStore.enabled
								? 'Disable memory for this chat'
								: 'Enable memory for this chat'}
						/>
					</span>
				{/if}
			{:else}
				<span class="overlay-facts">No chat open</span>
			{/if}
		</div>
	</header>

	<div class="mp-body panel-scroll">
		{#if !chat}
			<!-- No chat open: one shared empty state so it reads identically
			     to the memory sub-view's own empty. -->
			<div class="mp-empty">
				<EmptyState icon="brain" size="sm">Open a chat to manage its memory.</EmptyState>
			</div>
		{:else}
			<div class="mp-pane">
				{#if featurePromptsStore.memoryEnabled}
					<MemoryView bind:this={memoryView} />
				{:else}
					<div class="mp-off">
						<EmptyState icon="brain" size="sm" title="Chat Memory is off">
							With the engine off, no chat summarizes its older turns, so there is nothing
							for this panel to show.
							{#snippet actions()}
								<button type="button" class="mp-off-btn" onclick={openMemorySettings}>
									Turn on in Settings
								</button>
							{/snippet}
						</EmptyState>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.memory-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: transparent;
	}

	/* Air between the chat's name and the switch. */
	.mp-toggle {
		display: inline-flex;
		align-items: center;
		padding-left: 0.15rem;
	}

	/* ===== Body ===== */
	.mp-body {
		flex: 1;
		min-height: 0;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
	}

	/* Shared no-chat empty state: same recipe as the memory sub-view's own empty. */
	.mp-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.6rem;
		margin: auto;
		max-width: 30rem;
		padding: 0.9rem;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
	}

	/* MemoryView doesn't own its own height/scroll/padding (it flows in an
	   ancestor's scroll), so this pane supplies the padding and, for the off
	   note, centering. */
	.mp-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 0.9rem;
	}

	.mp-off {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.6rem;
		margin: auto;
		max-width: 26rem;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
	}

	.mp-off-btn {
		margin-top: 0.3rem;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 1rem;
		border: 0;
		border-radius: var(--radius-lg);
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 140ms ease;
	}

	.mp-off-btn:hover {
		background: var(--color-accent-hover);
	}
</style>
