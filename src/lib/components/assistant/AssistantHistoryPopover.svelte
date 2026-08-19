<script lang="ts">
	/**
	 * Session-history dropdown: search, recency-grouped list, open/rename/delete.
	 * Owns its own outside-press dismissal: a fixed backdrop can't cover the app from
	 * inside the widget (its backdrop-filter makes it the containing block), so a
	 * window pointerdown closes it; the panel's toggle button opts out via the
	 * [data-history-toggle] attribute.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { assistantSessionStore } from '$lib/stores/assistantSessions.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { formatRelativeTime } from '$lib/utils/date';
	import type { AssistantSession } from '$lib/types/assistant';

	interface Props {
		onClose: () => void;
		onNewSession: () => void;
	}
	let { onClose, onNewSession }: Props = $props();

	const store = assistantSessionStore;

	let rootEl = $state<HTMLElement | null>(null);
	let query = $state('');
	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');
	let activeId = $derived(store.activeTabId);

	function startRename(e: MouseEvent, id: string) {
		e.stopPropagation();
		renamingId = id;
		renameDraft = store.sessions.find((s) => s.id === id)?.title ?? 'Session';
	}

	async function commitRename() {
		if (!renamingId) return;
		const id = renamingId;
		renamingId = null;
		await store.renameSession(id, renameDraft);
	}

	async function openSession(id: string) {
		onClose();
		await store.openSession(id);
	}

	// The gate: the dialog names the session and its message count before anything is
	// touched (the destructive-act ladder, architecture/ui-shell-settings.md). Deletion is
	// immediate and final once confirmed.
	let deleteTarget = $state<AssistantSession | null>(null);
	let deleteMessage = $derived.by(() => {
		if (!deleteTarget) return '';
		const n = deleteTarget.messageCount ?? 0;
		const what = n > 0 ? `its ${n} message${n === 1 ? '' : 's'}` : 'its whole conversation';
		const running = store.runtime[deleteTarget.id]?.busy ? ' Its running turn is stopped first.' : '';
		return `Delete "${deleteTarget.title}" and ${what}? This cannot be undone.${running}`;
	});

	function askDeleteSession(e: MouseEvent, id: string) {
		e.stopPropagation();
		deleteTarget = store.sessions.find((s) => s.id === id) ?? null;
	}

	function confirmDeleteSession() {
		const target = deleteTarget;
		deleteTarget = null;
		if (target) void store.deleteSession(target.id);
	}

	function onWindowPointerDown(e: PointerEvent) {
		const t = e.target;
		if (!(t instanceof Node)) return;
		// The delete confirm portals to <body>, so a press inside it is outside rootEl.
		// Exempt the dialog, or answering it would also tear down this popover.
		if (t instanceof Element && t.closest('.dialog-portal')) return;
		if (rootEl && !rootEl.contains(t) && !(t instanceof Element && t.closest('[data-history-toggle]'))) {
			onClose();
		}
	}

	/** The chat this session worked against, resolved live: a deleted chat reads as nothing. */
	function chatTitleOf(session: { chatId?: string | null }): string | null {
		if (!session.chatId) return null;
		return chatStore.chats.find((c) => c.id === session.chatId)?.title ?? null;
	}

	/** Sessions filtered by the search box, bucketed by recency for scanning. */
	let historyGroups = $derived.by<{ label: string; sessions: typeof store.sessions }[]>(() => {
		const q = query.trim().toLowerCase();
		const filtered = q ? store.sessions.filter((s) => s.title.toLowerCase().includes(q)) : store.sessions;
		const startOfToday = new Date().setHours(0, 0, 0, 0);
		const dayMs = 86_400_000;
		const buckets: { label: string; min: number }[] = [
			{ label: 'Today', min: startOfToday },
			{ label: 'Yesterday', min: startOfToday - dayMs },
			{ label: 'Previous 7 days', min: startOfToday - 7 * dayMs },
			{ label: 'Older', min: -Infinity }
		];
		return buckets
			.map((bucket, i) => ({
				label: bucket.label,
				sessions: filtered.filter((s) => s.updatedAt >= bucket.min && (i === 0 || s.updatedAt < buckets[i - 1].min))
			}))
			.filter((g) => g.sessions.length > 0);
	});
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="assistant-history surface-float" bind:this={rootEl}>
	<div class="assistant-history-head">
		<Icon name="search" class="w-3.5 h-3.5 shrink-0 text-text-muted" />
		<!-- svelte-ignore a11y_autofocus -- the dropdown opens as a search surface -->
		<input
			class="assistant-history-search"
			placeholder="Search sessions…"
			bind:value={query}
			autofocus
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					// Consume the press so the workspace's global Esc stands down.
					e.preventDefault();
					e.stopPropagation();
					onClose();
				}
			}}
		/>
		<button type="button" class="assistant-history-new" onclick={onNewSession} title="New session">
			<Icon name="plus" class="w-3.5 h-3.5" />
			New
		</button>
	</div>
	<div class="assistant-history-list">
		{#if store.sessions.length === 0}
			<div class="assistant-history-empty">No past sessions yet.</div>
		{:else if historyGroups.length === 0}
			<div class="assistant-history-empty">Nothing matches "{query}".</div>
		{:else}
			{#each historyGroups as group (group.label)}
				<div class="assistant-history-group">{group.label}</div>
				{#each group.sessions as session (session.id)}
					<div
						class="assistant-history-item"
						class:assistant-history-item--active={session.id === activeId}
					>
						{#if renamingId === session.id}
							<!-- svelte-ignore a11y_autofocus -- the input replaces the clicked title -->
							<input
								class="assistant-history-rename"
								bind:value={renameDraft}
								autofocus
								onblur={commitRename}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									else if (e.key === 'Escape') {
										e.preventDefault();
										e.stopPropagation();
										renamingId = null;
									}
								}}
							/>
						{:else}
							{@const aboutChat = chatTitleOf(session)}
							<button type="button" class="assistant-history-open" onclick={() => openSession(session.id)}>
								<span class="assistant-history-title-row">
									{#if store.openTabIds.includes(session.id)}
										<span
											class="assistant-history-dot"
											class:assistant-history-dot--busy={store.runtime[session.id]?.busy}
											title={store.runtime[session.id]?.busy ? 'Running' : 'Open as a tab'}
										></span>
									{/if}
									<span class="assistant-history-title">{session.title}</span>
								</span>
								<span class="assistant-history-meta">
									{formatRelativeTime(session.updatedAt)}{session.messageCount ? ` · ${session.messageCount} message${session.messageCount === 1 ? '' : 's'}` : ''}{aboutChat ? ` · ${aboutChat}` : ''}
								</span>
							</button>
							<div class="assistant-history-actions">
								<button
									type="button"
									class="assistant-history-rename-btn"
									onclick={(e) => startRename(e, session.id)}
									aria-label="Rename session"
									title="Rename"
								>
									<Icon name="pencil" class="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									class="assistant-history-delete"
									onclick={(e) => askDeleteSession(e, session.id)}
									aria-label="Delete session"
									title="Delete"
								>
									<Icon name="trash" class="w-3.5 h-3.5" />
								</button>
							</div>
						{/if}
					</div>
				{/each}
			{/each}
		{/if}
	</div>
</div>

<ConfirmDialog
	open={deleteTarget !== null}
	title="Delete session"
	message={deleteMessage}
	confirmLabel="Delete"
	variant="danger"
	destructive
	onConfirm={confirmDeleteSession}
	onCancel={() => (deleteTarget = null)}
/>

<style>
	.assistant-history {
		position: absolute;
		top: 2.7rem;
		right: 0.5rem;
		z-index: 60;
		width: min(22rem, calc(100% - 1rem));
		max-height: 70%;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	.assistant-history-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.55rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.assistant-history-search {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.78rem;
	}

	.assistant-history-search:focus {
		outline: none;
	}

	.assistant-history-new {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.assistant-history-new:hover {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.assistant-history-list {
		overflow-y: auto;
		padding: 0.3rem;
	}

	.assistant-history-group {
		padding: 0.45rem 0.55rem 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.64rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.assistant-history-empty {
		padding: 0.8rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: var(--color-text-muted);
	}

	.assistant-history-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		padding: 0.4rem 0.55rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
	}

	.assistant-history-item:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
	}

	.assistant-history-item--active {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.assistant-history-open {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
		align-items: stretch;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 0;
		text-align: left;
	}

	.assistant-history-title-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	/* Session is open as a tab; pulses while its turn is still running. */
	.assistant-history-dot {
		flex-shrink: 0;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		opacity: 0.7;
	}

	.assistant-history-dot--busy {
		animation: assistant-pulse 1s ease-in-out infinite;
	}

	@keyframes assistant-pulse {
		0%, 100% { opacity: 0.3; }
		50% { opacity: 1; }
	}

	.assistant-history-title {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.assistant-history-meta {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	/* Row actions stay hidden until the row is hovered, so the list reads clean. */
	.assistant-history-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.assistant-history-item:hover .assistant-history-actions,
	.assistant-history-item:focus-within .assistant-history-actions {
		opacity: 1;
	}

	@media (pointer: coarse) {
		.assistant-history-actions {
			opacity: 1;
		}
	}

	.assistant-history-delete,
	.assistant-history-rename-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.assistant-history-rename-btn:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-history-rename {
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.45rem;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
	}

	.assistant-history-rename:focus {
		outline: none;
	}

	.assistant-history-delete:hover {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		color: var(--color-error);
	}
</style>
