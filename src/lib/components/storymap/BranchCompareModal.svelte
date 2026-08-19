<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { findActivePath } from '$lib/utils/message-tree';
	import { richDiff, type DiffLine } from '$lib/utils/diff';
	import { branchColorHex } from '$lib/utils/branch-labels';
	import type { Message } from '$lib/types/chat';

	interface Props {
		/** The two leaves to compare; null closes the modal. The open/closed condition lives
		 *  HERE, never in an `{#if}` at the call site: see the portal effect below. */
		leaves: { a: string; b: string } | null;
		onClose: () => void;
	}

	let { leaves, onClose }: Props = $props();

	let mode = $state<'diff' | 'read'>('diff');

	// Reactive so a turn edited in the chat behind this modal re-diffs live.
	let allMessages = $derived(chatStore.currentChatState?.allMessages ?? []);

	let leafA = $derived(leaves?.a ?? null);
	let leafB = $derived(leaves?.b ?? null);
	// Gated on being open: closed, this component still lives, and diffing every message
	// change behind a modal nobody is looking at is pure waste.
	let pathA = $derived(leafA ? findActivePath(allMessages, leafA) : []);
	let pathB = $derived(leafB ? findActivePath(allMessages, leafB) : []);

	// Length of the shared leading run (same ids in order), i.e. where the branches diverge.
	let commonLen = $derived.by(() => {
		let i = 0;
		while (i < pathA.length && i < pathB.length && pathA[i].id === pathB[i].id) i++;
		return i;
	});

	let forkNode = $derived(commonLen > 0 ? pathA[commonLen - 1] : null);
	let tailA = $derived(pathA.slice(commonLen));
	let tailB = $derived(pathB.slice(commonLen));
	let sameBranch = $derived(leafA === leafB || (tailA.length === 0 && tailB.length === 0));

	// Positional alignment of the two divergent tails.
	let rows = $derived.by(() => {
		const n = Math.max(tailA.length, tailB.length);
		const out: { a: Message | null; b: Message | null; diff: DiffLine[] | null }[] = [];
		for (let i = 0; i < n; i++) {
			const a = tailA[i] ?? null;
			const b = tailB[i] ?? null;
			out.push({ a, b, diff: a && b ? richDiff(a.content, b.content) : null });
		}
		return out;
	});

	// Branch identity chips: name a branch by the nearest label on its tail (leaf-first).
	function branchInfo(tail: Message[], fallback: string): { name: string; color: string | null } {
		for (let i = tail.length - 1; i >= 0; i--) {
			const l = tail[i].branchLabel;
			if (l) return { name: l.name, color: l.color };
		}
		return { name: fallback, color: null };
	}
	let infoA = $derived(branchInfo(tailA, 'Branch A'));
	let infoB = $derived(branchInfo(tailB, 'Branch B'));

	function leftLines(diff: DiffLine[]): DiffLine[] {
		return diff.filter((l) => l.type === 'same' || l.type === 'del');
	}
	function rightLines(diff: DiffLine[]): DiffLine[] {
		return diff.filter((l) => l.type === 'same' || l.type === 'add');
	}

	function paragraphs(text: string): string[] {
		return text
			.split(/\n{2,}/)
			.map((p) => p.trim())
			.filter(Boolean);
	}

	function roleLabel(m: Message): string {
		return m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Story' : 'System';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!leaves) return;
		if (e.key === 'Escape') {
			// Claim the key so the workspace's global Esc doesn't also close the
			// story map underneath on the same press.
			e.preventDefault();
			onClose();
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	// Portal to <body>, like Dialog, so the modal escapes the story-map overlay's stacking
	// context and paints above the title bar rather than beneath it.
	// Reads `leaves` so it re-runs on every open: bound to the component's lifetime alone it
	// runs once, and after its cleanup nothing puts the node back, so the modal then reads as
	// open while rendering nothing. The cleanup holds its own reference because `bind:this`
	// is nulled on unmount, which would skip the removal and strand the node in <body>.
	let portalEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		const el = portalEl;
		if (!leaves || !el) return;
		document.body.appendChild(el);
		return () => {
			if (el.parentNode === document.body) document.body.removeChild(el);
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if leaves}
<div bind:this={portalEl}>
<div
	class="cmp-backdrop panel-scroll"
	role="dialog"
	aria-modal="true"
	aria-label="Compare branches"
	tabindex="-1"
	use:focusTrap
	onclick={handleBackdrop}
	onkeydown={() => {}}
	transition:fade={{ duration: 160 }}
>
	<div class="cmp-panel surface-float" transition:fly={{ y: 18, duration: 180 }}>
		<header class="cmp-head">
			<div class="cmp-title">
				<Icon name="columns" class="w-5 h-5" />
				<h2>Compare branches</h2>
			</div>

			<div class="cmp-modes" role="tablist" aria-label="View mode">
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'diff'}
					class="cmp-mode"
					class:is-on={mode === 'diff'}
					onclick={() => (mode = 'diff')}
				>
					Diff
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'read'}
					class="cmp-mode"
					class:is-on={mode === 'read'}
					onclick={() => (mode = 'read')}
				>
					Read
				</button>
			</div>

			<button type="button" class="cmp-x" title="Close" onclick={onClose}>
				<Icon name="close" class="w-5 h-5" />
			</button>
		</header>

		<div class="cmp-branchbar">
			<div class="cmp-branch cmp-branch--a">
				{#if infoA.color}<span class="cmp-dot" style="background: {branchColorHex(infoA.color)};"></span>{/if}
				<span class="cmp-branch-name">{infoA.name}</span>
				<span class="cmp-branch-count">{tailA.length} turn{tailA.length === 1 ? '' : 's'}</span>
			</div>
			<div class="cmp-vs">vs</div>
			<div class="cmp-branch cmp-branch--b">
				{#if infoB.color}<span class="cmp-dot" style="background: {branchColorHex(infoB.color)};"></span>{/if}
				<span class="cmp-branch-name">{infoB.name}</span>
				<span class="cmp-branch-count">{tailB.length} turn{tailB.length === 1 ? '' : 's'}</span>
			</div>
		</div>

		<div class="cmp-body panel-scroll">
			{#if sameBranch}
				<div class="cmp-empty">
					<Icon name="columns" class="w-8 h-8 opacity-40" />
					<p>These two points are on the same branch, so there is nothing to compare.</p>
				</div>
			{:else}
				{#if forkNode}
					<div class="cmp-fork">
						<Icon name="sitemap" class="w-3.5 h-3.5" />
						<span>Diverged after turn {commonLen} · <em>{roleLabel(forkNode)}</em></span>
					</div>
				{:else}
					<div class="cmp-fork">
						<Icon name="sitemap" class="w-3.5 h-3.5" />
						<span>Separate roots, no shared history</span>
					</div>
				{/if}

				{#each rows as row, i (i)}
					<div class="cmp-row">
						<!-- Left / Branch A -->
						<div class="cmp-cell cmp-cell--a">
							{#if row.a}
								<div class="cmp-cell-head">
									<span class="cmp-cell-role cmp-cell-role--{row.a.role}">{roleLabel(row.a)}</span>
									<span class="cmp-cell-turn">#{commonLen + i + 1}</span>
								</div>
								{#if mode === 'diff'}
									<div class="cmp-diff">
										{#if row.diff}
											{#each leftLines(row.diff) as line, li (li)}
												{#if line.type === 'same'}
													<div class="dl dl--same"><span class="dl-text">{line.text || ' '}</span></div>
												{:else if line.type === 'del'}
													<div class="dl dl--del">
														<span class="dl-text"
															>{#each line.segs as seg, s (s)}{#if seg.changed}<mark class="dm dm--del">{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span
														>
													</div>
												{/if}
											{/each}
										{:else}
											<div class="dl dl--solo"><span class="dl-text">{row.a.content || ' '}</span></div>
										{/if}
									</div>
								{:else}
									<div class="cmp-read">
										{#each paragraphs(row.a.content) as para, pi (pi)}
											<p class="para-text">{para}</p>
										{/each}
									</div>
								{/if}
							{:else}
								<div class="cmp-cell-missing">no turn on this branch</div>
							{/if}
						</div>

						<!-- Right / Branch B -->
						<div class="cmp-cell cmp-cell--b">
							{#if row.b}
								<div class="cmp-cell-head">
									<span class="cmp-cell-role cmp-cell-role--{row.b.role}">{roleLabel(row.b)}</span>
									<span class="cmp-cell-turn">#{commonLen + i + 1}</span>
								</div>
								{#if mode === 'diff'}
									<div class="cmp-diff">
										{#if row.diff}
											{#each rightLines(row.diff) as line, li (li)}
												{#if line.type === 'same'}
													<div class="dl dl--same"><span class="dl-text">{line.text || ' '}</span></div>
												{:else if line.type === 'add'}
													<div class="dl dl--add">
														<span class="dl-text"
															>{#each line.segs as seg, s (s)}{#if seg.changed}<mark class="dm dm--add">{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span
														>
													</div>
												{/if}
											{/each}
										{:else}
											<div class="dl dl--solo"><span class="dl-text">{row.b.content || ' '}</span></div>
										{/if}
									</div>
								{:else}
									<div class="cmp-read">
										{#each paragraphs(row.b.content) as para, pi (pi)}
											<p class="para-text">{para}</p>
										{/each}
									</div>
								{/if}
							{:else}
								<div class="cmp-cell-missing">no turn on this branch</div>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
</div>
{/if}

<style>
	.cmp-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 4vh 1rem;
		background: var(--color-overlay);
		backdrop-filter: var(--backdrop-blur);
	}

	.cmp-panel {
		width: 100%;
		max-width: 68rem;
		max-height: 92dvh;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}

	.cmp-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 0.9rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.cmp-title {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-primary);
	}

	.cmp-title h2 {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 1rem;
		font-weight: 700;
	}

	.cmp-modes {
		margin-left: auto;
		display: inline-flex;
		padding: 0.15rem;
		gap: 0.15rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-bg-secondary) 80%, transparent);
		border: 1px solid var(--color-border-subtle);
	}

	.cmp-mode {
		border: 0;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		padding: 0.28rem 0.7rem;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.cmp-mode.is-on {
		background: var(--color-accent);
		color: #fff;
	}

	.cmp-x {
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.cmp-x:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	.cmp-branchbar {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.9rem;
		border-bottom: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 45%, transparent);
	}

	.cmp-branch {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.cmp-branch--b {
		justify-content: flex-end;
	}

	.cmp-dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.cmp-branch-name {
		font-family: var(--font-ui);
		font-size: 0.84rem;
		font-weight: 700;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cmp-branch-count {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.cmp-vs {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.cmp-body {
		flex: 1;
		min-height: 0;
		padding: 0.75rem 0.9rem 1.1rem;
	}

	.cmp-fork {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 auto 0.75rem;
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		border: 1px solid var(--color-border-subtle);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
		width: max-content;
	}

	.cmp-fork em {
		font-style: normal;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.cmp-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
		margin-bottom: 0.7rem;
	}

	.cmp-cell {
		min-width: 0;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 40%, transparent);
		overflow: hidden;
	}

	.cmp-cell--a {
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	.cmp-cell--b {
		border-left: 2px solid color-mix(in srgb, var(--color-text-secondary) 55%, transparent);
	}

	.cmp-cell-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.55rem;
		border-bottom: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
	}

	/* Tinted per role, the story map inspector's recipe: a filled pill needs a text colour
	   that reads on every role hue in every theme, and no single value gives that. */
	.cmp-cell-role {
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.08rem 0.4rem;
		border-radius: var(--radius-full);
		color: var(--rc);
		background: color-mix(in srgb, var(--rc) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--rc) 38%, transparent);
	}

	.cmp-cell-role--user {
		--rc: var(--color-accent);
	}
	.cmp-cell-role--assistant {
		--rc: var(--color-text-secondary);
	}
	.cmp-cell-role--system {
		--rc: var(--color-text-muted);
	}

	.cmp-cell-turn {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.cmp-cell-missing {
		padding: 1rem 0.6rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-style: italic;
		color: var(--color-text-muted);
	}

	/* ===== Diff view ===== */
	.cmp-diff {
		padding: 0.4rem 0.55rem;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		line-height: 1.55;
	}

	.dl {
		display: block;
		padding: 0.02rem 0.15rem;
	}

	.dl-text {
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--color-text-primary);
	}

	.dl--del {
		background: color-mix(in srgb, var(--color-error) 9%, transparent);
	}

	.dl--add {
		background: color-mix(in srgb, var(--color-success) 9%, transparent);
	}

	.dl--del .dl-text,
	.dl--add .dl-text {
		color: color-mix(in srgb, var(--color-text-primary) 66%, transparent);
	}

	.dl--solo .dl-text {
		color: var(--color-text-secondary);
	}

	.dm {
		border-radius: 0.25rem;
		padding: 0 0.1rem;
		color: var(--color-text-primary);
	}

	.dm--add {
		background: color-mix(in srgb, var(--color-success) 34%, transparent);
		font-weight: 600;
	}

	.dm--del {
		background: color-mix(in srgb, var(--color-error) 30%, transparent);
	}

	/* ===== Read view ===== */
	.cmp-read {
		padding: 0.45rem 0.55rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.para-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.84rem;
		line-height: 1.55;
		color: var(--color-text-primary);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.cmp-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 3rem 1rem;
		text-align: center;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.88rem;
	}

	@media (max-width: 720px) {
		.cmp-row {
			grid-template-columns: 1fr;
		}
	}
</style>
