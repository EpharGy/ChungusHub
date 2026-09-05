<script lang="ts">
	/**
	 * The chat notepad: the reader's own notes about the story they are in, in a floating,
	 * dockable window that stays on screen while they work anywhere else in the app.
	 *
	 * Mounted once at the shell's top level and driven by `notepadStore`, never by the title
	 * bar's button. The button only toggles; everything about whose notes these are, when the
	 * window goes away and when it comes back lives in the store.
	 *
	 * This is also where the window is told the reader has moved to another story, and which
	 * stories still exist, because it is the one part of the feature mounted for the app's
	 * whole life. See the effects.
	 *
	 * It shares its shell with the image pop-out (`FloatingWindow`) and differs from it in one
	 * way that matters: the notepad has a launcher, so closing is reversible and the X is not
	 * a destructive act. The only destructive act here is Clear, and it asks.
	 */
	import { untrack } from 'svelte';
	import Icon from './Icon.svelte';
	import FloatingWindow from './FloatingWindow.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { notepadStore } from '$lib/stores/notepad.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let chat = $derived(chatStore.currentChatState?.chat ?? null);
	let title = $derived(chat?.title?.trim() || 'Untitled chat');

	/** The textarea, for the two things that need the element itself rather than its value:
	 *  jumping to the end, and putting the caret back after an export. */
	let field = $state<HTMLTextAreaElement | undefined>();
	let confirmingClear = $state(false);

	/**
	 * Whether to show how much room is left.
	 *
	 * Silent until the last tenth of the budget, deliberately. A counter on screen from the
	 * first keystroke reads as a limit someone is expected to write up against, and this cap
	 * exists to protect the chat-list fetch, not to ration anybody's notes. Two thousand
	 * characters of warning is several paragraphs of notice.
	 */
	let nearCap = $derived(notepadStore.remaining <= 2000);

	/**
	 * The chat this effect last saw loaded. A plain variable rather than a rune on purpose:
	 * it is the effect's own bookkeeping and nothing renders it. `undefined` is "not yet
	 * run", which is distinct from the `null` of the welcome screen.
	 */
	let lastChatId: string | null | undefined = undefined;

	// Hand the window over to whichever story the reader is now in. Deliberately an EDGE, not
	// an invariant: it acts only when the loaded chat actually changes, so opening the window
	// is never undone in the frame it happened. Re-asserting "the window matches the record"
	// every tick would fight the button.
	//
	// Skipped on mobile, where the window is unreachable by design: `FloatingWindow` renders
	// nothing there and the title bar's button is hidden, so restoring one would mean state
	// nobody can see or close.
	$effect(() => {
		const chatId = chat?.id ?? null;
		if (chatId === lastChatId) return;
		lastChatId = chatId;
		if (!viewport.isMobile) untrack(() => notepadStore.followChat(chatId));
	});

	// Sweep the standing-window record for stories that no longer exist. The notes need no
	// sweep of their own: they are a column on the chat row and went with it. Driven off the
	// live chat list rather than out of the delete paths, so one row, a batch, and a delete
	// arriving from another device are all the same event here, and no caller has to know
	// this feature exists. Cheap: it writes only when something actually goes.
	$effect(() => {
		const live = new Set(chatStore.chats.map((c) => c.id));
		untrack(() => notepadStore.pruneTo(live));
	});

	// The debounce's last end. A reload or a tab close is the one exit that does not pass
	// through a blur, a close or a chat switch, and losing the sentence someone was mid-way
	// through is exactly the kind of small loss that makes a notepad untrustworthy.
	$effect(() => {
		const onLeave = () => void notepadStore.flush();
		window.addEventListener('beforeunload', onLeave);
		return () => window.removeEventListener('beforeunload', onLeave);
	});

	/** Caret and scroll to the end, then hand the keyboard back: the point of the button is
	 *  to carry on writing at the bottom of a long note, not merely to look at it. */
	function jumpToEnd(): void {
		if (!field) return;
		const end = field.value.length;
		field.focus();
		field.setSelectionRange(end, end);
		field.scrollTop = field.scrollHeight;
	}

	/** A filename from the chat's own title, so a folder of exports is readable. Falls back
	 *  rather than producing a bare extension when a title is all punctuation. */
	function safeFilename(name: string): string {
		return (
			name
				.replace(/[^a-z0-9]+/gi, '-')
				.replace(/^-+|-+$/g, '')
				.toLowerCase() || 'chat'
		);
	}

	/** Plain text, because that is what the window holds: nothing here is formatted, and a
	 *  .json wrapper around one string would only be something to unwrap later. */
	function exportText(): void {
		const text = notepadStore.text;
		if (!text) {
			toastStore.info('There are no notes to export yet.');
			return;
		}
		const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${safeFilename(title)}-notes.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function confirmClear(): void {
		confirmingClear = false;
		notepadStore.clear();
		field?.focus();
	}
</script>

<FloatingWindow
	open={notepadStore.open}
	storageKey="notepad-rect"
	minSize={{ w: 260, h: 200 }}
	defaultSize={{ w: 420, h: 480 }}
	ariaLabel="Notes for {title}"
>
	{#snippet header()}
		<span class="np-title" title="Notes for {title}">{title}</span>

		<button
			type="button"
			class="np-btn"
			onclick={jumpToEnd}
			title="Jump to the end"
			aria-label="Jump to the end of the notes"
		>
			<Icon name="chevronDown" class="w-4 h-4" strokeWidth={1.8} />
		</button>
		<button
			type="button"
			class="np-btn"
			onclick={exportText}
			title="Export as a text file"
			aria-label="Export the notes as a text file"
		>
			<Icon name="download" class="w-4 h-4" strokeWidth={1.8} />
		</button>
		<button
			type="button"
			class="np-btn np-btn--danger"
			onclick={() => (confirmingClear = true)}
			disabled={!notepadStore.hasNotes}
			title="Clear these notes"
			aria-label="Clear these notes"
		>
			<Icon name="trash" class="w-4 h-4" strokeWidth={1.8} />
		</button>
		<button
			type="button"
			class="np-btn"
			onclick={() => notepadStore.close()}
			title="Close (the notes are kept)"
			aria-label="Close the notepad"
		>
			<Icon name="close" class="w-4 h-4" strokeWidth={1.8} />
		</button>
	{/snippet}

	<div class="np">
		<!-- `value` + `oninput` rather than `bind:value`: the store is the source of truth and
		     clamps what it is given, so a two-way binding would let an over-long paste sit on
		     screen looking accepted while the clamped copy is what gets saved. -->
		<textarea
			bind:this={field}
			class="np-text"
			value={notepadStore.text}
			oninput={(e) => notepadStore.write(e.currentTarget.value)}
			onblur={() => void notepadStore.flush()}
			placeholder="Notes for this chat. Only you read these - they are never sent to the model."
			aria-label="Notes for {title}"
			spellcheck="false"
		></textarea>

		{#if nearCap}
			<p class="np-cap" role="status">
				{Math.max(notepadStore.remaining, 0).toLocaleString()} characters left
			</p>
		{/if}
	</div>
</FloatingWindow>

<ConfirmDialog
	open={confirmingClear}
	title="Clear these notes?"
	message={`Everything written in the notepad for "${title}" goes. There is no undo, and nothing else on screen holds a copy.`}
	confirmLabel="Clear"
	variant="danger"
	destructive
	onConfirm={confirmClear}
	onCancel={() => (confirmingClear = false)}
/>

<style>
	/* FloatingWindow's body is a flex ROW, so the column that stacks the field over its
	   warning line lives here rather than there. */
	.np {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.np-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.np-btn {
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
		transition: background-color 120ms ease, color 120ms ease;
	}

	.np-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.np-btn--danger:hover:not(:disabled) {
		color: var(--color-error);
	}

	.np-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.np-text {
		flex: 1;
		min-height: 0;
		width: 100%;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
		/* The reading font, not the UI one: this is prose the reader wrote, and it sits
		   beside a transcript set in the same face. */
		font-family: var(--font-body);
		font-size: 0.82rem;
		line-height: 1.55;
		padding: 0.6rem 0.7rem;
		/* The window is the frame; a second scrollbar inside a rounded panel would need its
		   own inset to not collide with the corner radius. */
		scrollbar-gutter: stable;
	}

	.np-text::placeholder {
		color: var(--color-text-muted);
	}

	.np-cap {
		flex-shrink: 0;
		margin: 0;
		padding: 0.25rem 0.7rem 0.4rem;
		border-top: 1px solid var(--color-border-subtle);
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}
</style>
