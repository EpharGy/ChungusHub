<script lang="ts">
	/**
	 * Looking at an attached file: the same text, addressed the same way, the assistant reads.
	 *
	 * Read-only, and it never holds the whole file: a 10 MB attachment would freeze the tab if
	 * it reached the DOM in one string, so this pages through the server a window at a time and
	 * the reader asks for more. The gutter carries the SAME 1-based line numbers `read_file`
	 * and `search_file` speak, which is what lets a person check a line the assistant quoted.
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { readFileLines, type AssistantFile } from '$lib/services/assistantFilesService';
	import { fileKindLabel } from '$shared/assistant-files';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { file, onClose }: { file: AssistantFile | null; onClose: () => void } = $props();

	/** Lines per fetch. Big enough that most attachments open whole, small enough that the
	 *  worst case still paints in one frame. */
	const PAGE = 500;

	let lines = $state<string[]>([]);
	let shown = $state(0);
	let total = $state(0);
	let loading = $state(false);
	let failed = $state<string | null>(null);

	/** Each file opens fresh: the previous one's window must never render under a new header. */
	$effect(() => {
		const id = file?.id;
		lines = [];
		shown = 0;
		total = 0;
		failed = null;
		if (id) void loadMore(id, 1);
	});

	async function loadMore(id: string, from: number): Promise<void> {
		loading = true;
		try {
			const page = await readFileLines(id, from, from + PAGE - 1);
			// The file may have been swapped out from under a slow request (the dialog moved
			// on); dropping the answer is the only honest thing to do with it.
			if (file?.id !== id) return;
			lines = from === 1 ? page.lines : [...lines, ...page.lines];
			shown = page.toLine;
			total = page.totalLines;
		} catch (e) {
			failed = e instanceof Error ? e.message : String(e);
			toastStore.failed('read this file', e);
		} finally {
			loading = false;
		}
	}

	let remaining = $derived(Math.max(0, total - shown));
	let gutter = $derived(String(total).length);
	let subtitle = $derived(
		file ? `${fileKindLabel(file.kind)} · ${total || file.lines} lines · ~${file.tokenEstimate} tokens to read whole` : ''
	);
</script>

<Dialog open={!!file} {onClose} title={file?.name ?? ''} size="xl">
	<p class="file-meta">{subtitle}</p>
	{#if failed}
		<p class="file-failed">{failed}</p>
	{:else if total === 0 && !loading}
		<p class="file-meta">This file has no lines.</p>
	{:else}
		<div class="file-body">
			{#each lines as line, i (i)}
				<div class="file-row">
					<span class="file-num" style="width: {gutter}ch">{i + 1}</span>
					<span class="file-text">{line || ' '}</span>
				</div>
			{/each}
		</div>
		{#if remaining > 0}
			<button type="button" class="file-more" disabled={loading} onclick={() => file && loadMore(file.id, shown + 1)}>
				{loading ? 'Reading…' : `Show more (${remaining} line${remaining === 1 ? '' : 's'} left)`}
			</button>
		{/if}
	{/if}
</Dialog>

<style>
	.file-meta {
		margin-bottom: 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.file-failed {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-error);
	}

	.file-body {
		max-height: 60vh;
		overflow: auto;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-bg-tertiary);
		padding: 0.5rem 0;
	}

	.file-row {
		display: flex;
		gap: 0.75rem;
		padding: 0 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.5;
	}

	.file-num {
		flex-shrink: 0;
		text-align: right;
		color: var(--color-text-muted);
		opacity: 0.7;
		user-select: none;
	}

	/* The text wraps rather than scrolling sideways: a re-printed JSON has short lines, and
	   the one case that does not (a minified file we could not re-print) is exactly where a
	   horizontal scrollbar would hide the content instead of showing it. */
	.file-text {
		white-space: pre-wrap;
		word-break: break-word;
	}

	.file-more {
		margin-top: 0.6rem;
		width: 100%;
		padding: 0.4rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		font-family: var(--font-ui);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.file-more:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
	}
	.file-more:disabled {
		cursor: default;
		opacity: 0.6;
	}
</style>
