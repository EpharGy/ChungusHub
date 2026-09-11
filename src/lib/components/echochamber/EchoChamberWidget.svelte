<script lang="ts">
	/**
	 * EchoChamber's feed, in the app's shared floating panel.
	 *
	 * Everything about where this sits, how it is dragged, docked, resized and remembered is
	 * `FloatingWindow`'s (see `architecture/floating-window.md`). What is left here is the
	 * feature: which feed is on screen, whether it is stale, and the three controls that act
	 * on it.
	 *
	 * This used to carry its own copy of that geometry, and the comment at the top of the file
	 * said extracting a shared shell would have meant rewriting `AssistantFloatingWidget`, 900
	 * lines of upstream file. **That reason expired**: the shell was extracted as a port of the
	 * Assistant's maths rather than a refactor of it, so the merge surface the duplication was
	 * buying has not existed since. The copy went with it, and so did the launcher: the panel
	 * registry gives every panel a title-bar entry, which is a better way back than a button
	 * pinned to the edge of the screen and fighting the Assistant's for room.
	 *
	 * Mounted at the shell and never gated on being open, because the effect below has to run
	 * whether the feed is on screen or put away.
	 */
	import FloatingWindow from '$lib/components/ui/FloatingWindow.svelte';
	import FloatingPanelButton from '$lib/components/ui/FloatingPanelButton.svelte';
	import { PANEL_ICONS } from '$lib/utils/floating-panels';
	import ReactionFeed from './ReactionFeed.svelte';
	import { echoChamberStore } from '$lib/stores/echochamber.svelte';

	let enabled = $derived(echoChamberStore.settings.enabled);

	let displayed = $derived(echoChamberStore.displayed);
	let feed = $derived(displayed?.feed ?? null);
	let messageId = $derived(echoChamberStore.currentMessageId);
	let busy = $derived(echoChamberStore.generatingFor !== null);
	let error = $derived(echoChamberStore.lastError);

	/** The feed on screen belongs to an earlier turn than the newest reply. True while a new
	 *  one is being written, and after deleting the newest turn's feed. Said out loud rather
	 *  than left to be inferred: stale reactions passed off as current is the one way keeping
	 *  the previous feed on screen can mislead. */
	let stale = $derived(displayed !== null && messageId !== null && displayed.messageId !== messageId);

	// Ask on every change; the store decides whether that means a call. Same contract as
	// SpriteLayer's, and here for the same reason: a reply committed while the reader was in
	// another chat was never reacted to, and the sidecar that would have done it only ever runs
	// once, from the generation that placed the row. Mounted with the widget rather than gated on
	// the panel being open, so arriving at a chat behaves the same whether the feed is on screen
	// or put away, which is how the per-turn sidecar already behaves.
	$effect(() => {
		echoChamberStore.ensureForNewestReply();
	});

	function regenerate() {
		if (messageId) void echoChamberStore.regenerate(messageId);
	}

	/**
	 * Throw the current feed away.
	 *
	 * Deliberately does NOT regenerate afterwards. This exists for a feed that came out
	 * wrong, and a reader who wants a different one presses refresh; spending a call on
	 * their behalf here would make delete impossible to use as "stop showing me this".
	 *
	 * Nothing confirms it either: the feed is decoration, regenerating costs one call, and a
	 * dialog in front of a one-click undo is friction with nothing behind it.
	 */
	function forget() {
		// Deletes what is ON SCREEN, not the newest turn: those differ while a feed is being
		// written, and a delete button that removes something you cannot see is a trap.
		if (displayed) void echoChamberStore.forget(displayed.messageId);
	}
</script>

<!--
	`open` carries the engine's own switch as well as the reader's. Turning EchoChamber off
	takes the panel with it rather than leaving a window whose every control is inert, and it
	goes through the shell's exit transition on the way, which wrapping the whole component in
	an `{#if}` would cut.
-->
<FloatingWindow
	open={enabled && echoChamberStore.open}
	storageKey="echochamber-widget-rect"
	minSize={{ w: 280, h: 300 }}
	defaultSize={{ w: 360, h: 520 }}
	ariaLabel="EchoChamber"
	onHide={() => echoChamberStore.close()}
	hideLabel="Hide the feed (the reactions are kept)"
>
	{#snippet header()}
		<!-- A plain title, set like the notepad's and the gallery window's: the panel's own
		     glyph lives on its title-bar entry, and repeating it here would be the one header
		     in the app that opens with an icon. -->
		<span class="echo-title">EchoChamber</span>

		<!-- The style picker is the panel's own verb and stays a select: it is a choice among
		     fourteen, which no glyph in the shared vocabulary spells. -->
		<select
			class="echo-style"
			aria-label="Chat style"
			value={echoChamberStore.settings.styleId}
			onchange={(e) => echoChamberStore.update({ styleId: e.currentTarget.value })}
		>
			{#each echoChamberStore.styles as style (style.id)}
				<option value={style.id}>{style.name}</option>
			{/each}
		</select>

		{#if busy}
			<FloatingPanelButton
				icon="stop"
				label="Stop listening to the crowd"
				onclick={() => echoChamberStore.cancel()}
			/>
		{:else}
			<FloatingPanelButton
				icon="refresh"
				label={messageId
					? 'Generate reactions for the newest reply'
					: 'No reply to react to yet'}
				onclick={regenerate}
				disabled={!messageId}
			/>
		{/if}

		<FloatingPanelButton
			icon={PANEL_ICONS.clear}
			label={feed
				? 'Delete these reactions. They stop being sent as history too.'
				: 'Nothing to delete'}
			onclick={forget}
			disabled={!feed || busy}
			danger
		/>
	{/snippet}

	<div class="echo-content">
		{#if busy}
			<p class="echo-status">Listening to the crowd…</p>
		{:else if error}
			<p class="echo-status echo-status--error">{error}</p>
		{/if}

		{#if stale && feed}
			<p class="echo-status echo-status--stale">
				{busy ? 'Reactions to the previous reply' : 'From an earlier reply'}
			</p>
		{/if}

		<ReactionFeed
			reactions={feed?.reactions ?? []}
			emptyMessage={messageId
				? 'Nothing yet. Press refresh to hear what they think.'
				: 'Send a message first, then the crowd has something to react to.'}
		/>
	</div>
</FloatingWindow>

<style>
	.echo-title {
		flex: 0 0 auto;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.echo-style {
		flex: 1;
		min-width: 0;
		margin-left: 0.25rem;
		padding: 0.15rem 0.3rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.35rem;
		cursor: pointer;
	}

	/* FloatingWindow's body is a flex ROW, so the scroll container that stacks the status
	   lines over the feed claims the width itself rather than inheriting it. */
	.echo-content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem 0.5rem 0.75rem;
	}

	.echo-status {
		margin: 0;
		padding: 0.5rem 0.25rem 0;
		font-size: 0.78rem;
		color: var(--color-text-tertiary);
	}
	.echo-status--error {
		color: var(--color-danger, #ef4444);
	}

	/* Quieter than the working line above it: this is a caption on the feed below, not an
	   event. Italic so it never reads as one of the reactions. */
	.echo-status--stale {
		font-size: 0.72rem;
		font-style: italic;
		opacity: 0.75;
	}
</style>
