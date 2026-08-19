<script lang="ts">
	/**
	 * The card a paused turn is waiting on, above the composer and deliberately NOT a modal:
	 * nothing has been written yet, so there is no emergency. The user must be able to scroll
	 * the transcript, read the chat behind the panel, and take as long as they like. Every line
	 * on it was derived server-side before anything ran (`Capability.preview`), by the same pure
	 * functions the result carries afterwards, so the card and the result cannot disagree.
	 *
	 * It answers one question in one place, and the layout follows from that: WHICH things are
	 * about to happen. So rows repeating one act (twenty message deletes from one chat) collapse
	 * under that act stated once, with what is true of the act (permanence, how far a delete
	 * reaches) beside it rather than copied onto every row; and each row underneath carries only
	 * what makes it that row: which turn, what it says, what it costs. Grouping is render-time
	 * only, exactly like the timeline's batching: `index` is the server's ordinal and every
	 * answer is addressed by it, never by row position.
	 *
	 * Answering is per row, per group, or in one gesture, and the choice is the user's. A
	 * row-by-row pass sends nothing until the LAST row is decided, because the server takes
	 * exactly one outcome per card: a half-answered card would refuse everything the user had
	 * not reached yet.
	 *
	 * The parent keys this component on the card's `askId`, so the next card of the turn
	 * arrives as a fresh instance with nothing decided.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import AssistantDiffInline from './AssistantDiffInline.svelte';
	import AssistantDiffModal from './AssistantDiffModal.svelte';
	import { toolIcon } from '$lib/config/assistant-icons';
	import { goToTarget } from '$lib/services/assistant-targets';
	import type { AssistantApprovalCall, AssistantToolResult } from '$lib/services/transport';

	let {
		calls,
		onRespond
	}: {
		calls: AssistantApprovalCall[];
		onRespond: (approved: number[]) => void;
	} = $props();

	/** Row decisions so far, keyed by the call's own `index`, never by row position, which is
	 *  what the server matches its tool calls on. */
	let decided = $state<Record<number, boolean>>({});
	/** The answer has left this device. The card stays on screen for the round trip, so its
	 *  buttons must stop answering: the server ignores a second answer, but the user should
	 *  not be able to aim one. */
	let sent = $state(false);
	let activeDiff = $state<AssistantToolResult | null>(null);
	let collapsed = $state<Record<string, boolean>>({});

	let allIndexes = $derived(calls.map((c) => c.index));

	/** Runs of one act, in the order the model asked for them. Same tool + same act + same
	 *  container = the same thing happening repeatedly, which is the only case worth folding. */
	interface CallGroup {
		key: string;
		act: string;
		within: string;
		calls: AssistantApprovalCall[];
	}

	let groups = $derived.by(() => {
		const out: CallGroup[] = [];
		const byKey = new Map<string, CallGroup>();
		for (const call of calls) {
			const act = call.act ?? call.label;
			const key = `${call.tool}|${act}|${call.within ?? ''}`;
			let group = byKey.get(key);
			if (!group) {
				group = { key, act, within: call.within ?? '', calls: [] };
				byKey.set(key, group);
				out.push(group);
			}
			group.calls.push(call);
		}
		return out;
	});

	/** Groups big enough to be a wall start folded; a pair or a trio is easier read than opened. */
	const AUTO_COLLAPSE_FROM = 4;
	function isOpen(group: CallGroup): boolean {
		return collapsed[group.key] ?? group.calls.length < AUTO_COLLAPSE_FROM;
	}

	/** Where the group happens, and (when its rows are positions in one chat) which stretch
	 *  of it. "turns #41 to #60" is the fact that tells someone what they are about to lose. */
	function whereLine(group: CallGroup): string {
		const positions = group.calls.map((c) => c.at).filter((n): n is number => typeof n === 'number');
		const parts: string[] = [];
		if (group.within) parts.push(`in ${group.within}`);
		if (positions.length === group.calls.length && positions.length > 1) {
			const from = Math.min(...positions);
			const to = Math.max(...positions);
			if (from !== to) parts.push(`turns #${from} to #${to}`);
		}
		return parts.join(' · ');
	}

	/** One clipped line of what a folded row is about, so a collapsed group still shows its
	 *  contents rather than a count. Deleted text sits in `before`, new text in `after`. */
	function snippet(call: AssistantApprovalCall): string {
		const text = call.diff?.before?.trim() || call.diff?.after?.trim() || '';
		return text.replace(/\s+/g, ' ');
	}

	function respond(approved: number[]): void {
		if (sent) return;
		sent = true;
		onRespond(approved);
	}

	/** Decide one or many rows at once. The last row answered IS the answer: there is nothing
	 *  left to ask about, so the card sends itself. */
	function decide(indexes: number[], approved: boolean): void {
		if (sent) return;
		const next = { ...decided };
		for (const index of indexes) next[index] = approved;
		decided = next;
		if (calls.every((c) => c.index in next)) {
			respond(calls.filter((c) => next[c.index]).map((c) => c.index));
		}
	}

	function verdictOf(group: CallGroup): string {
		const answered = group.calls.filter((c) => c.index in decided);
		if (answered.length < group.calls.length) return '';
		const yes = answered.filter((c) => decided[c.index]).length;
		if (yes === answered.length) return 'approved';
		if (yes === 0) return 'refused';
		return `${yes} approved, ${answered.length - yes} refused`;
	}

	/** The diff panel takes a tool result; a pending call has the same two texts. Its own head
	 *  shows the field rather than the label, which the row above already carries. */
	function diffAction(call: AssistantApprovalCall): AssistantToolResult {
		return { type: call.tool, label: call.diff?.title || call.label, diff: call.diff };
	}
</script>

{#snippet answer(indexes: number[], what: string)}
	<button
		type="button"
		class="apv-btn apv-btn--yes"
		disabled={sent}
		onclick={() => decide(indexes, true)}
		title="Let this run"
		aria-label="Approve {what}"
	>
		<Icon name="check" class="w-3.5 h-3.5" strokeWidth={2.5} />
	</button>
	<button
		type="button"
		class="apv-btn apv-btn--no"
		disabled={sent}
		onclick={() => decide(indexes, false)}
		title="Drop this, the turn carries on without it"
		aria-label="Refuse {what}"
	>
		<Icon name="close" class="w-3.5 h-3.5" strokeWidth={2.5} />
	</button>
{/snippet}

{#snippet notes(list: AssistantApprovalCall['notes'])}
	{#each list as note, i (i)}
		<p class="apv-note" class:apv-note--warn={note.warn}>{note.text}</p>
	{/each}
{/snippet}

<!-- A row: which one, and nothing its group has already said. `folded` rows live under a
     group heading, so they drop the act, the icon rail and the full diff for a single line. -->
{#snippet row(call: AssistantApprovalCall, folded: boolean)}
	{@const answered = call.index in decided}
	<div
		class="apv-row"
		class:apv-row--folded={folded}
		class:apv-row--destructive={call.risk === 'delete' && !folded}
		class:apv-row--decided={answered}
	>
		<div class="apv-row-head">
			{#if !folded}
				<Icon name={toolIcon({ type: call.tool })} class="w-3.5 h-3.5 shrink-0 apv-icon" />
				{#if call.act}<span class="apv-act">{call.act}</span>{/if}
			{/if}
			{#if call.target}
				<button type="button" class="apv-label apv-label--go" onclick={() => call.target && void goToTarget(call.target)} title="Look at this in the app">
					<span class="apv-label-text">{call.label}</span>
					<Icon name="arrowRight" class="w-3 h-3 shrink-0 apv-go" />
				</button>
			{:else}
				<span class="apv-label">{call.label}</span>
			{/if}
			{#if !folded}<span class="apv-tool">{call.tool}</span>{/if}
			{#if answered}
				<span class="apv-verdict">{decided[call.index] ? 'approved' : 'refused'}</span>
			{:else}
				{@render answer([call.index], call.label)}
			{/if}
		</div>
		{#if !folded && call.within}
			<p class="apv-where">in {call.within}</p>
		{/if}
		{#if !folded && call.actNotes}{@render notes(call.actNotes)}{/if}
		{@render notes(call.notes)}
		{#if call.diff}
			{#if folded}
				<button type="button" class="apv-snippet" onclick={() => (activeDiff = diffAction(call))} title="Read all of it">
					{snippet(call)}
				</button>
			{:else}
				<div class="apv-diff">
					<AssistantDiffInline action={diffAction(call)} icon={toolIcon({ type: call.tool })} onExpand={() => (activeDiff = diffAction(call))} />
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

<section class="apv" aria-label="Calls waiting for your approval">
	<header class="apv-head">
		<Icon name="shield" class="w-3.5 h-3.5 shrink-0" />
		<span class="apv-title" aria-live="polite">
			{calls.length === 1 ? 'The assistant wants to run this' : `The assistant wants to run ${calls.length} calls`}
		</span>
	</header>

	<div class="apv-rows panel-scroll">
		{#each groups as group (group.key)}
			{#if group.calls.length === 1}
				{@render row(group.calls[0], false)}
			{:else}
				{@const open = isOpen(group)}
				<!-- The group's pair answers what is LEFT: a row already decided by hand must not
				     be flipped by a gesture aimed at the others. -->
				{@const indexes = group.calls.filter((c) => !(c.index in decided)).map((c) => c.index)}
				{@const verdict = verdictOf(group)}
				{@const where = whereLine(group)}
				<!-- The act's own facts are read off the first row: every row in the group shares
				     the act, and a preview derives both of these from it. -->
				<div class="apv-group" class:apv-group--destructive={group.calls[0].risk === 'delete'} class:apv-row--decided={!!verdict}>
					<div class="apv-row-head">
						<button type="button" class="apv-fold" onclick={() => (collapsed[group.key] = !open)} aria-expanded={open}>
							<Icon name={open ? 'chevronDown' : 'chevronRight'} class="w-3 h-3 shrink-0" />
							<Icon name={toolIcon({ type: group.calls[0].tool })} class="w-3.5 h-3.5 shrink-0 apv-icon" />
							<span class="apv-act">{group.act}</span>
							<span class="apv-count">{group.calls.length}</span>
						</button>
						{#if verdict}
							<span class="apv-verdict">{verdict}</span>
						{:else}
							{@render answer(indexes, `all ${indexes.length} of ${group.act}`)}
						{/if}
					</div>
					{#if where}<p class="apv-where">{where}</p>{/if}
					{#if group.calls[0].actNotes}{@render notes(group.calls[0].actNotes)}{/if}
					{#if open}
						<div class="apv-group-rows">
							{#each group.calls as call (call.index)}{@render row(call, true)}{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	{#if calls.length > 1}
		<footer class="apv-foot">
			<button type="button" class="apv-bulk apv-bulk--no" disabled={sent} onclick={() => respond([])}>Refuse all</button>
			<button type="button" class="apv-bulk apv-bulk--yes" disabled={sent} onclick={() => respond(allIndexes)}>Approve all</button>
		</footer>
	{/if}
</section>

<AssistantDiffModal action={activeDiff} onClose={() => (activeDiff = null)} />

<style>
	.apv {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 88%, transparent);
	}

	.apv-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--color-border-subtle);
		color: var(--color-accent);
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
	}

	.apv-title {
		flex: 1;
		min-width: 0;
	}

	/* The card is capped and scrolls its own rows: a turn that stopped on five diffs must not
	   push the composer (the thing the user answers with) off the panel. */
	.apv-rows {
		min-height: 0;
		max-height: min(20rem, 42vh);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.35rem;
	}

	.apv-row,
	.apv-group {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.35rem 0.45rem;
		border-radius: var(--radius-sm);
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 50%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
	}

	/* A delete reads as a delete before it is read at all: it is the one row on this card
	   that cannot be taken back afterwards. */
	.apv-row--destructive,
	.apv-group--destructive {
		border-left-color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 9%, transparent);
	}

	/* Decided rows recede: what is left undecided is what still needs the user. */
	.apv-row--decided {
		opacity: 0.55;
	}

	/* A row under a group heading is one line of evidence, not a card of its own: the group
	   owns the frame, the act and the colour. */
	.apv-row--folded {
		padding: 0.15rem 0 0.15rem 0.45rem;
		border-left: 1px solid var(--color-border-subtle);
		border-radius: 0;
		background: transparent;
	}

	.apv-group-rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin-top: 0.15rem;
	}

	.apv-row-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.apv-fold {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		color: var(--color-text-secondary);
	}

	.apv-act {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	/* The count is the group's whole point: how many times this is about to happen. */
	.apv-count {
		flex-shrink: 0;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		font-family: var(--font-ui);
		font-size: 0.64rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.apv-label {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.3;
		color: var(--color-text-primary);
		text-align: left;
	}

	.apv-label-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.apv-label--go {
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.apv-label--go:hover {
		color: var(--color-accent);
	}

	.apv-label--go :global(svg.apv-go) {
		color: var(--color-text-muted);
	}

	.apv-row-head :global(svg.apv-icon) {
		color: var(--color-text-muted);
	}

	.apv-tool {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.62rem;
		color: var(--color-text-muted);
	}

	.apv-verdict {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.apv-where {
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.apv-note {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		line-height: 1.35;
		color: var(--color-text-muted);
		word-break: break-word;
	}

	.apv-note--warn {
		color: var(--color-warning);
	}

	/* One line of the text that is about to change or go, clipped by construction: twenty of
	   these must not turn the card into a page. The whole of it is one click away. */
	.apv-snippet {
		display: block;
		width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.apv-snippet:hover {
		color: var(--color-text-secondary);
	}

	.apv-diff {
		margin-top: 0.15rem;
	}

	.apv-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.apv-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* A folded row's own pair is quieter than its group's: the group is the gesture people
	   reach for, and twenty full-strength button pairs would fight it. */
	.apv-row--folded .apv-btn {
		width: 1.25rem;
		height: 1.25rem;
		border-color: transparent;
		background: transparent;
		color: var(--color-text-muted);
	}

	.apv-btn--yes:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-success) 55%, transparent);
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
		color: var(--color-success);
	}

	.apv-btn--no:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-error) 55%, transparent);
		background: color-mix(in srgb, var(--color-error) 18%, transparent);
		color: var(--color-error);
	}

	.apv-foot {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.5rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.apv-bulk {
		padding: 0.25rem 0.55rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.apv-bulk:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.apv-bulk--yes:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-success) 55%, transparent);
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
		color: var(--color-text-primary);
	}

	.apv-bulk--no:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-error) 55%, transparent);
		background: color-mix(in srgb, var(--color-error) 18%, transparent);
		color: var(--color-text-primary);
	}

</style>
