<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import type { AssistantToolResult } from '$lib/services/transport';
	import { richDiff, condenseLines, diffLineCounts, type DiffLine } from '$lib/utils/diff';

	let { action, onClose }: { action: AssistantToolResult | null; onClose: () => void } = $props();

	/** Context lines kept around each change, wider than the clipped inline preview's, since
	 *  this view has the room and a rewrite reads badly without the sentences either side. */
	const CONTEXT = 3;

	let full = $derived(action?.diff ? richDiff(action.diff.before, action.diff.after) : []);
	// Counted over the WHOLE diff, never the condensed view: the header states what changed,
	// not what is currently on screen.
	let counts = $derived(diffLineCounts(full));
	let title = $derived(action?.diff?.title || action?.label || 'Changes');

	/** Gaps the reader has opened, keyed by where they start in `full`. Cleared per diff, or a
	 *  card opened on the next edit would inherit the last one's expansions. */
	let opened = $state<Record<number, boolean>>({});
	$effect(() => {
		void action;
		opened = {};
	});

	/**
	 * What renders: the condensed diff, with every opened gap put back in full. A whole-field
	 * write is mostly unchanged text, and drawing all of it turned reading one edited sentence
	 * into scrolling the entire card.
	 */
	let lines = $derived.by<DiffLine[]>(() => {
		const out: DiffLine[] = [];
		for (const line of condenseLines(full, CONTEXT)) {
			if (line.type === 'gap' && opened[line.from]) out.push(...full.slice(line.from, line.to));
			else out.push(line);
		}
		return out;
	});
</script>

<Dialog open={!!action?.diff} {onClose} {title} size="xl">
	<div class="diff-meta">
		<span class="diff-add">+{counts.add}</span>
		<span class="diff-del">−{counts.del}</span>
	</div>
	<div class="diff">
		{#each lines as line, i (i)}
			{#if line.type === 'gap'}
				<button
					type="button"
					class="diff-gap"
					onclick={() => (opened = { ...opened, [line.from]: true })}
					title="Show what is between the changes"
				>
					⋯ {line.count} unchanged line{line.count === 1 ? '' : 's'}
				</button>
			{:else if line.type === 'same'}
				<div class="diff-row diff-row--same">
					<span class="diff-sign"></span>
					<span class="diff-text">{line.text || ' '}</span>
				</div>
			{:else}
				<div class="diff-row diff-row--{line.type}">
					<span class="diff-sign">{line.type === 'add' ? '+' : '−'}</span>
					<span class="diff-text"
						>{#each line.segs as seg, s (s)}{#if seg.changed}<mark class="diff-mark diff-mark--{line.type}">{seg.text}</mark
							>{:else}{seg.text}{/if}{/each}</span
					>
				</div>
			{/if}
		{/each}
	</div>
</Dialog>

<style>
	.diff-meta {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 0.6rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.78rem;
	}

	.diff-add {
		color: var(--color-success);
	}

	.diff-del {
		color: var(--color-error);
	}

	.diff {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		font-family: var(--font-mono, monospace);
		font-size: 0.76rem;
		line-height: 1.5;
	}

	.diff-row {
		display: flex;
		gap: 0.4rem;
		padding: 0.05rem 0.5rem;
	}

	.diff-row--add {
		background: color-mix(in srgb, var(--color-success) 12%, transparent);
	}

	.diff-row--del {
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.diff-sign {
		flex-shrink: 0;
		width: 0.8rem;
		text-align: center;
		user-select: none;
		color: var(--color-text-muted);
	}

	.diff-row--add .diff-sign {
		color: var(--color-success);
	}

	.diff-row--del .diff-sign {
		color: var(--color-error);
	}

	.diff-text {
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--color-text-primary);
	}

	/* Carried-over words stay calm; the edited words pop. */
	.diff-row--add .diff-text,
	.diff-row--del .diff-text {
		color: color-mix(in srgb, var(--color-text-primary) 62%, transparent);
	}

	.diff-mark {
		border-radius: 0.25rem;
		padding: 0 0.1rem;
		color: var(--color-text-primary);
	}

	.diff-mark--add {
		background: color-mix(in srgb, var(--color-success) 36%, transparent);
		font-weight: 600;
	}

	.diff-mark--del {
		background: color-mix(in srgb, var(--color-error) 32%, transparent);
	}

	/* The one row that is a control: it stands for the text left out, and pressing it puts
	   that text back. Tinted rather than bordered so a gap at either end of the diff doesn't
	   double up on the container's own edge. */
	.diff-gap {
		display: block;
		width: 100%;
		padding: 0.15rem 0.5rem;
		border: 0;
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
		color: var(--color-text-muted);
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
		text-align: left;
		cursor: pointer;
		user-select: none;
	}

	.diff-gap:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-text-primary);
	}
</style>
