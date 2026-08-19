<script lang="ts">
	/**
	 * The composer's feature row: Add picker, the attach menu, hand-attached chips
	 * (removable; they ask for full: the server resolves what actually goes and the sent
	 * message's own chips state it), the auto-attach ghost chip (mirrors the focused
	 * panel; click mutes), and (pinned to the far end) this tab's approval mode. One row for
	 * one concept: everything here shapes the NEXT turn rather than the conversation so far.
	 *
	 * The two triggers sit together at the head of the row, before anything they can
	 * produce. Attach is a MENU on the chat composer's recipe rather than a direct
	 * file-picker trigger, and it now holds both attachable kinds: a picture the model
	 * LOOKS at, and a file it READS. They are separate rows because they are separate
	 * questions: the picker filters differently, and a file the model cannot see is not a
	 * failed image.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { APPROVAL_MODES, approvalModeInfo, type ApprovalModeInfo } from '$lib/config/assistant-approval';
	import { attachmentKindIcon } from '$lib/config/assistant-icons';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { imageService } from '$lib/services/imageService';
	import { ASSISTANT_FILE_ACCEPT, type AssistantFile } from '$lib/services/assistantFilesService';
	import { fileKindLabel } from '$shared/assistant-files';
	import { attachmentKey, type ApprovalMode, type AssistantAttachment } from '$lib/types/assistant';

	interface Props {
		autoAttachment: AssistantAttachment | null;
		autoOff: boolean;
		manualAttachments: AssistantAttachment[];
		busy: boolean;
		/** How much this tab asks before the assistant acts. Read here so the mode can never be
		 *  forgotten: the card that stops a turn appears in the same block. */
		approvalMode: ApprovalMode;
		onToggleAuto: () => void;
		/** Files uploaded but not yet sent: they ride the next turn and can still be dropped. */
		stagedFiles: AssistantFile[];
		onAdd: (att: AssistantAttachment) => void;
		onRemoveManual: (att: AssistantAttachment) => void;
		onFiles: (files: File[]) => void;
		onDocuments: (files: File[]) => void;
		onRemoveFile: (id: string) => void;
		onOpenFile: (file: AssistantFile) => void;
		onApprovalMode: (mode: ApprovalMode) => void;
	}
	let {
		autoAttachment,
		autoOff,
		manualAttachments,
		busy,
		approvalMode,
		stagedFiles,
		onToggleAuto,
		onAdd,
		onRemoveManual,
		onFiles,
		onDocuments,
		onRemoveFile,
		onOpenFile,
		onApprovalMode
	}: Props = $props();

	let showPicker = $state(false);
	let pickerQuery = $state('');
	let pickerWrapEl = $state<HTMLElement | null>(null);
	let showAttach = $state(false);
	let attachWrapEl = $state<HTMLElement | null>(null);
	let showApproval = $state(false);
	let approvalWrapEl = $state<HTMLElement | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();
	let documentInput: HTMLInputElement | undefined = $state();
	/** The loose mode waiting on its confirmation, if one is. */
	let pendingMode = $state<ApprovalModeInfo | null>(null);

	let current = $derived(approvalModeInfo(approvalMode));

	/** Loosening THIS tab asks the same question the settings page asks, every time: a mode
	 *  moved for one job is exactly the one nobody remembers moving. */
	function pickApprovalMode(choice: ApprovalModeInfo) {
		showApproval = false;
		if (choice.mode === approvalMode) return;
		if (choice.warning) pendingMode = choice;
		else onApprovalMode(choice.mode);
	}

	// Everything attachable (chats + library entries) minus what's already a chip.
	let shownKeys = $derived.by<Set<string>>(() => {
		const keys = new Set<string>();
		if (autoAttachment) keys.add(attachmentKey(autoAttachment));
		for (const m of manualAttachments) keys.add(attachmentKey(m));
		return keys;
	});

	let pickerItems = $derived.by<AssistantAttachment[]>(() => {
		const q = pickerQuery.trim().toLowerCase();
		const all: AssistantAttachment[] = [
			...chatStore.chats.map((c) => ({ kind: 'chat', refId: c.id, label: c.title }) as AssistantAttachment),
			...characterLibraryStore.entries.map(
				(e) =>
					({
						kind: 'entry',
						refId: e.id,
						entryType: e.type,
						label: e.identity.name || 'Untitled',
						imageUrl: imageService.thumbnailUrl(e.identity.imageUrl) ?? undefined
					}) as AssistantAttachment
			)
		];
		return all.filter((a) => !shownKeys.has(attachmentKey(a)) && (!q || a.label.toLowerCase().includes(q)));
	});

	function attachmentIcon(att: AssistantAttachment) {
		return attachmentKindIcon(att.kind, att.entryType);
	}

	function addItem(att: AssistantAttachment) {
		onAdd(att);
		pickerQuery = '';
	}

	function pickImage() {
		showAttach = false;
		fileInput?.click();
	}

	function pickDocument() {
		showAttach = false;
		documentInput?.click();
	}

	function handleFilePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		onFiles(Array.from(input.files ?? []));
		input.value = '';
	}

	function handleDocumentPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		onDocuments(Array.from(input.files ?? []));
		input.value = '';
	}

	/** A staged file's chip line: what it turned out to be, and what reading it costs. */
	function fileTitle(file: AssistantFile): string {
		return `${fileKindLabel(file.kind)} · ${file.lines} lines · ~${file.tokenEstimate} tokens`;
	}

	/** Close the pop-overs on any press outside them: a fixed backdrop can't cover the
	 *  app from inside the widget (backdrop-filter makes it the containing block). */
	function onWindowPointerDown(e: PointerEvent) {
		const t = e.target;
		if (!(t instanceof Node)) return;
		if (showPicker && pickerWrapEl && !pickerWrapEl.contains(t)) showPicker = false;
		if (showAttach && attachWrapEl && !attachWrapEl.contains(t)) showAttach = false;
		if (showApproval && approvalWrapEl && !approvalWrapEl.contains(t)) showApproval = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="assistant-attach-row">
	<div class="assistant-pop-wrap" bind:this={pickerWrapEl}>
		<button
			type="button"
			class="assistant-add-btn"
			class:assistant-add-btn--active={showPicker}
			onclick={() => (showPicker = !showPicker)}
			aria-label="Attach a chat or character"
			title="Attach a chat or character"
		>
			<Icon name="plus" class="w-3.5 h-3.5" />
			<span>Add</span>
		</button>
		{#if showPicker}
			<div class="assistant-picker surface-float">
				<input
					class="assistant-picker-search"
					placeholder="Attach a chat or character…"
					bind:value={pickerQuery}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							// Consume the press so the workspace's global Esc stands down.
							e.preventDefault();
							e.stopPropagation();
							showPicker = false;
						}
					}}
				/>
				<div class="assistant-picker-list">
					{#if pickerItems.length === 0}
						<div class="assistant-picker-empty">Nothing to add.</div>
					{:else}
						{#each pickerItems.slice(0, 40) as item (attachmentKey(item))}
							<button type="button" class="assistant-picker-item" onclick={() => addItem(item)}>
								{#if item.imageUrl}
									<img class="assistant-picker-avatar" src={item.imageUrl} alt="" loading="lazy" />
								{:else}
									<span class="assistant-picker-avatar assistant-picker-avatar--icon">
										<Icon name={attachmentIcon(item)} class="w-3.5 h-3.5" />
									</span>
								{/if}
								<span class="assistant-picker-item-label">{item.label}</span>
								<span class="assistant-picker-item-kind">{item.kind === 'chat' ? 'chat' : item.entryType}</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	</div>
	<div class="assistant-pop-wrap" bind:this={attachWrapEl}>
		<button
			type="button"
			class="assistant-attach-btn"
			class:assistant-attach-btn--active={showAttach}
			onclick={() => (showAttach = !showAttach)}
			disabled={busy}
			aria-label="Attach"
			title="Attach"
			aria-haspopup="menu"
			aria-expanded={showAttach}
		>
			<Icon name="paperclip" class="w-3.5 h-3.5" />
		</button>
		{#if showAttach}
			<div class="assistant-attach-menu surface-float">
				<button type="button" class="assistant-picker-item" title="PNG, JPEG, WebP or GIF" onclick={pickImage}>
					<Icon name="image" class="w-3.5 h-3.5 shrink-0" />
					<span class="assistant-picker-item-label">Image…</span>
				</button>
				<button type="button" class="assistant-picker-item" title="Text the assistant reads: notes, JSON, a character card" onclick={pickDocument}>
					<Icon name="document" class="w-3.5 h-3.5 shrink-0" />
					<span class="assistant-picker-item-label">File…</span>
				</button>
			</div>
		{/if}
	</div>
	{#each manualAttachments as att (attachmentKey(att))}
		<span class="assistant-chip assistant-chip--manual" title={att.label}>
			<Icon name={attachmentIcon(att)} class="w-3 h-3 shrink-0" />
			<span class="assistant-chip-label">{att.label}</span>
			<button type="button" class="assistant-chip-btn assistant-chip-btn--remove" onclick={() => onRemoveManual(att)} aria-label="Remove from context">
				<Icon name="close" class="w-3 h-3" />
			</button>
		</span>
	{/each}
	<!-- Staged files wear the manual chip, because that is what they are: something the
	     user handed over for the next turn. The label opens the viewer, so what is about to
	     be sent can be read before it is. -->
	{#each stagedFiles as file (file.id)}
		<span class="assistant-chip assistant-chip--manual" title={fileTitle(file)}>
			<Icon name="document" class="w-3 h-3 shrink-0" />
			<button type="button" class="assistant-chip-label assistant-chip-open" onclick={() => onOpenFile(file)}>{file.name}</button>
			<button type="button" class="assistant-chip-btn assistant-chip-btn--remove" onclick={() => onRemoveFile(file.id)} aria-label="Remove this file">
				<Icon name="close" class="w-3 h-3" />
			</button>
		</span>
	{/each}
	{#if autoAttachment}
		<button
			type="button"
			class="assistant-chip assistant-chip--auto"
			class:assistant-chip--off={autoOff}
			class:assistant-chip--selection={autoAttachment.kind === 'selection'}
			onclick={onToggleAuto}
			title={autoOff
				? `${autoAttachment.label} · muted, click to attach`
				: autoAttachment.kind === 'selection'
					? `Highlighted in chat, the assistant's target. Click to mute.`
					: `${autoAttachment.label} · open now, auto-attached, click to mute`}
		>
			<Icon name={attachmentIcon(autoAttachment)} class="w-3 h-3 shrink-0" />
			<span class="assistant-chip-label">{autoAttachment.label}</span>
		</button>
	{/if}
	<!-- Pinned to the far end so it never moves as chips come and go: a safety switch the user
	     has to hunt for is a safety switch they stop trusting. -->
	<div class="assistant-pop-wrap assistant-approval-wrap" bind:this={approvalWrapEl}>
		<button
			type="button"
			class="assistant-approval-pill"
			class:assistant-approval-pill--critical={!!current.badge}
			class:assistant-approval-pill--active={showApproval}
			onclick={() => (showApproval = !showApproval)}
			title="What this tab reviews before the assistant acts"
			aria-haspopup="menu"
			aria-expanded={showApproval}
		>
			<Icon name="shield" class="w-3 h-3 shrink-0" />
			<span>{current.label}</span>
		</button>
		{#if showApproval}
			<div class="assistant-approval-menu surface-float" role="menu">
				{#each APPROVAL_MODES as choice (choice.mode)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={approvalMode === choice.mode}
						class="assistant-approval-item"
						class:assistant-approval-item--on={approvalMode === choice.mode}
						onclick={() => pickApprovalMode(choice)}
					>
						<span class="assistant-approval-item-head">
							<span class="assistant-approval-item-label">{choice.label}</span>
							{#if choice.badge}
								<span class="assistant-approval-badge">{choice.badge}</span>
							{/if}
						</span>
						<span class="assistant-approval-item-hint">{choice.hint}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
	<ConfirmDialog
		open={!!pendingMode}
		title={pendingMode?.warning?.title ?? ''}
		message={pendingMode?.warning?.message ?? ''}
		confirmLabel={pendingMode?.warning?.confirmLabel ?? ''}
		variant="danger"
		onConfirm={() => {
			if (pendingMode) onApprovalMode(pendingMode.mode);
			pendingMode = null;
		}}
		onCancel={() => (pendingMode = null)}
	/>
	<!-- Outside the menu on purpose: picking the row closes it, and an input that
	     unmounts in the same tick never gets to open its file dialog. -->
	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/webp,image/gif"
		multiple
		class="hidden"
		onchange={handleFilePick}
	/>
	<!-- The filter is convenience only: what a file IS gets decided server-side, by shape. -->
	<input
		bind:this={documentInput}
		type="file"
		accept={ASSISTANT_FILE_ACCEPT}
		multiple
		class="hidden"
		onchange={handleDocumentPick}
	/>
</div>

<style>
	.assistant-attach-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.assistant-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		max-width: 12rem;
		padding: 0.2rem 0.3rem 0.2rem 0.45rem;
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.7rem;
	}

	/* Auto-attached (focused panel): a quiet, dashed "ghost" chip. It is itself the
	   toggle: clicking mutes/unmutes it, so there's no close button. */
	.assistant-chip--auto {
		padding: 0.2rem 0.5rem;
		border: 1px dashed color-mix(in srgb, var(--color-accent) 38%, transparent);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: opacity 120ms ease, background-color 120ms ease;
	}

	.assistant-chip--auto:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	/* A live chat highlight is the strongest auto-context: solid + filled so it reads as a
	   deliberate "act here" target rather than a quiet ghost. */
	.assistant-chip--selection {
		border-style: solid;
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-chip--selection:hover {
		background: color-mix(in srgb, var(--color-accent) 23%, transparent);
	}

	/* Muted: dimmed + struck through; still mirrors focus, just not sent. */
	.assistant-chip--auto.assistant-chip--off {
		opacity: 0.45;
	}

	.assistant-chip--off .assistant-chip-label {
		text-decoration: line-through;
	}

	/* Hand-added: a solid, prominent chip so it reads as deliberate. */
	.assistant-chip--manual {
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-chip-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/** A staged file's name is the door to its viewer, so it reads as a chip label and
	 *  behaves as a button. No second control crowds a chip this size. */
	.assistant-chip-open {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}
	.assistant-chip-open:hover {
		text-decoration: underline;
	}

	.assistant-chip-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.assistant-chip-btn:hover {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-chip-btn--remove:hover {
		background: color-mix(in srgb, var(--color-error) 16%, transparent);
		color: var(--color-error);
	}

	.assistant-pop-wrap {
		position: relative;
		display: inline-flex;
	}

	.assistant-attach-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.assistant-attach-btn:hover:not(:disabled),
	.assistant-attach-btn--active {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-attach-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Same anchoring as the Add picker so the two pop-overs read as one build. */
	.assistant-attach-menu {
		position: absolute;
		bottom: calc(100% + 0.35rem);
		left: 0;
		z-index: 71;
		min-width: 10rem;
		padding: 0.25rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.assistant-picker {
		position: absolute;
		bottom: calc(100% + 0.35rem);
		left: 0;
		z-index: 71;
		width: min(20rem, 70vw);
		max-height: 16rem;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	.assistant-picker-search {
		flex-shrink: 0;
		padding: 0.45rem 0.6rem;
		border: none;
		border-bottom: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.76rem;
	}

	.assistant-picker-search:focus {
		outline: none;
	}

	.assistant-picker-list {
		overflow-y: auto;
		padding: 0.25rem;
	}

	.assistant-picker-empty {
		padding: 0.6rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.assistant-picker-item {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.76rem;
		cursor: pointer;
		text-align: left;
	}

	.assistant-picker-item:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	.assistant-picker-avatar {
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		object-fit: cover;
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
	}

	.assistant-picker-avatar--icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.assistant-picker-item-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.assistant-picker-item-kind {
		flex-shrink: 0;
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.assistant-add-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.5rem 0.2rem 0.4rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.assistant-add-btn:hover,
	.assistant-add-btn--active {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	/* Last in the row and pushed to its end, so a wrapping line of chips never displaces it. */
	.assistant-approval-wrap {
		margin-left: auto;
	}

	.assistant-approval-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.45rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.assistant-approval-pill:hover,
	.assistant-approval-pill--active {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-text-primary);
	}

	/* The mode that reviews nothing wears its tint always: it is the state whose whole cost
	   is that you forgot you were in it. */
	.assistant-approval-pill--critical {
		border-color: color-mix(in srgb, var(--color-error) 50%, transparent);
		color: var(--color-error);
	}

	.assistant-approval-menu {
		position: absolute;
		bottom: calc(100% + 0.35rem);
		right: 0;
		z-index: 71;
		width: min(17rem, 70vw);
		padding: 0.25rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.assistant-approval-item {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		text-align: left;
	}

	.assistant-approval-item:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	.assistant-approval-item--on {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.assistant-approval-item-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.assistant-approval-item-label {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	/* Reads before the row is chosen, not after: it names the review that row does not run. */
	.assistant-approval-badge {
		flex-shrink: 0;
		padding: 0.05rem 0.35rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-error) 45%, transparent);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		color: var(--color-error);
		font-family: var(--font-ui);
		font-size: 0.55rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.assistant-approval-item-hint {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		line-height: 1.3;
		color: var(--color-text-muted);
	}
</style>
