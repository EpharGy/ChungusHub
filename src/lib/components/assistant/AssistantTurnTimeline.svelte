<script lang="ts">
	/**
	 * The assistant's turn timeline: user bubbles and bubble-less, chronological
	 * assistant turns (text + thinking + tool steps), for both persisted messages and
	 * the live streaming turn. Owns everything a rendered step can do: navigate to
	 * what a tool touched, expand a diff, retry a failed turn, continue a
	 * budget-capped one.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import AssistantThinking from './AssistantThinking.svelte';
	import AssistantDiffInline from './AssistantDiffInline.svelte';
	import AssistantDiffModal from './AssistantDiffModal.svelte';
	import AssistantActivityLine from './AssistantActivityLine.svelte';
	import AssistantWorkMotion from './AssistantWorkMotion.svelte';
	import { assistantSessionStore } from '$lib/stores/assistantSessions.svelte';
	import { imageService } from '$lib/services/imageService';
	import { navigateTo } from '$lib/services/navigation';
	import { goToTarget, targetOfToolResult } from '$lib/services/assistant-targets';
	import { attachmentKindIcon, toolIcon } from '$lib/config/assistant-icons';
	import { renderMarkdown } from '$lib/utils/markdown';
	import type { AssistantToolResult } from '$lib/services/transport';
	import type { AssistantMessage, AssistantSessionRuntime, AssistantStep } from '$lib/types/assistant';
	import type { SentAttachment, SentAttachmentMode } from '$shared/assistant-attachments';
	import { fileKindLabel } from '$shared/assistant-files';
	import type { AssistantFile } from '$lib/services/assistantFilesService';

	interface Props {
		messages: AssistantMessage[];
		runtime: AssistantSessionRuntime;
		activeId: string | null;
		onRetry: () => void;
		onContinue: () => void;
		/** Opens an attached file in the viewer the panel owns: one viewer for the chips
		 *  here and the ones still staged in the composer. */
		onOpenFile: (file: AssistantFile) => void;
	}
	let { messages, runtime, activeId, onRetry, onContinue, onOpenFile }: Props = $props();

	const store = assistantSessionStore;

	let activeDiff = $state<AssistantToolResult | null>(null);
	/** Position in the tab's picture roster open in the full-size viewer; null = closed. */
	let viewerIndex = $state<number | null>(null);

	// ===== The tab's pictures =====
	// The viewer pages the WHOLE tab, not one bubble: this list is the same append-only roster
	// the assistant numbers its "attachment N" by (loop.ts `collectUserImages`), so the viewer's
	// counter reads as the address the assistant itself speaks, and "attachment 3" can be
	// swiped to. Its order is the order the transcript shows, so next always means further down.
	// The starts are built by the same walk as the list, since two sends of one file would make
	// a path lookup ambiguous.
	let roster = $derived.by(() => {
		const images: string[] = [];
		const startOf = new Map<string, number>();
		for (const m of messages) {
			if (m.role !== 'user' || !m.images?.length) continue;
			startOf.set(m.id, images.length);
			images.push(...m.images);
		}
		return { images, startOf };
	});

	function openImage(messageId: string, i: number) {
		const start = roster.startOf.get(messageId);
		if (start === undefined) throw new Error(`Message ${messageId} shows images but holds no roster position`);
		viewerIndex = start + i;
	}

	// ===== What rode with a sent message =====
	// The chips on a user bubble state the mode the server RESOLVED each attachment to
	// (never the composer's intent) in the tag word, so the truth is readable, not a hover
	// or a style the reader has to decode.
	const MODE_TAGS: Record<SentAttachmentMode, string> = {
		full: 'in full',
		clipped: 'clipped',
		pointer: 'pointer',
		oversize: 'too long, pointer',
		known: 'already read'
	};

	/** What each tag actually means. The tag is four characters of shorthand and its meaning
	 *  is written nowhere else on the screen, so this is what the tooltip is for; the chip's
	 *  own hover already says it is pressable. */
	const MODE_HINTS: Record<SentAttachmentMode, string> = {
		full: 'Sent in full. The assistant holds this content and will not read it again.',
		clipped: 'The highlight was longer than the limit, so it went clipped.',
		pointer: 'Only a pointer went. The assistant reads the content with a tool when it needs it.',
		oversize: 'Too long to include, so only a pointer went. The assistant reads it with a tool.',
		known: 'This conversation already held it unchanged, so it was not sent again.'
	};

	/** Same routing table as every other assistant surface (assistant-targets.ts); a
	 *  selection points at the message it anchored to. */
	function goToAttachment(att: SentAttachment): void {
		if (att.kind === 'selection') {
			if (att.anchorMessageId) void goToTarget({ kind: 'message', id: att.anchorMessageId });
			return;
		}
		if (att.kind === 'entry') {
			void goToTarget({ kind: att.entryType === 'persona' ? 'persona' : 'character', id: att.refId });
			return;
		}
		void goToTarget({ kind: att.kind, id: att.refId });
	}

	// ===== Navigate to what a tool touched =====
	// The routing itself is shared with the approval card (assistant-targets.ts): both point
	// at the same places, and a second copy here would drift the first time one moved.
	function isNavigable(tool: AssistantToolResult): boolean {
		if (tool.error) return false;
		return !!tool.nav || !!targetOfToolResult(tool);
	}

	function navigateToTool(tool: AssistantToolResult) {
		if (tool.error) return;
		// Both arms minimize the full-screen mobile widget themselves: the destination
		// renders below it, and the tap would otherwise look dead.
		if (tool.nav) {
			void navigateTo(tool.nav);
			return;
		}
		const target = targetOfToolResult(tool);
		if (target) void goToTarget(target);
	}

	/** Normalize a persisted turn to a timeline; falls back for legacy (pre-steps) rows. */
	function messageSteps(m: AssistantMessage): AssistantStep[] {
		if (m.steps?.length) return m.steps;
		const steps: AssistantStep[] = [];
		if (m.actions) for (const tool of m.actions) steps.push({ kind: 'tool', tool });
		if (m.content) steps.push({ kind: 'text', text: m.content });
		return steps;
	}

	// ===== Action batching =====
	// The model batches independent tool calls into one step (the system prompt asks it
	// to), so a bulk job lands as a run of consecutive tool steps. Rendering each one
	// inline floods the timeline, so runs of BATCH_MIN+ collapse into one expandable row.
	// Grouping is render-time only: the persisted step array is exactly what the server
	// committed, and nothing here may reshape it.
	const BATCH_MIN = 3;
	type ToolStep = Extract<AssistantStep, { kind: 'tool' }>;
	type RenderUnit =
		| { kind: 'step'; step: AssistantStep; index: number }
		| { kind: 'batch'; items: { step: ToolStep; index: number }[]; start: number };

	/** Collapse consecutive tool steps (BATCH_MIN or more) into batch units. */
	function groupSteps(steps: AssistantStep[]): RenderUnit[] {
		const units: RenderUnit[] = [];
		let run: { step: ToolStep; index: number }[] = [];
		const flush = () => {
			if (run.length >= BATCH_MIN) units.push({ kind: 'batch', items: run, start: run[0].index });
			else for (const it of run) units.push({ kind: 'step', step: it.step, index: it.index });
			run = [];
		};
		steps.forEach((step, index) => {
			if (step.kind === 'tool') run.push({ step, index });
			else {
				flush();
				units.push({ kind: 'step', step, index });
			}
		});
		flush();
		return units;
	}

	/** Expanded batches, keyed `${messageId|'live'}:${startIndex}`, collapsed by default. */
	let openBatches = $state<Record<string, boolean>>({});

	// ===== Step details (auditability) =====
	// Every non-diff step can expand to show what was asked (args) and what came back, in
	// full: an agent with write access lives or dies on "I can see exactly what you did",
	// and a cut result cannot answer that. Diff rows already carry their evidence.
	let openDetails = $state<Record<string, boolean>>({});

	function hasDetail(tool: AssistantToolResult): boolean {
		return tool.args != null || typeof tool.resultPreview === 'string';
	}

	/** Tool results ride the wire as compact JSON: one line, exactly what the model reads.
	 *  This panel is the only place a HUMAN reads them, so it indents them like the arguments
	 *  block above. Anything that doesn't parse is shown verbatim: the point is to read what
	 *  came back, never to hide it behind a formatting failure. */
	function formatResult(raw: string): string {
		try {
			return JSON.stringify(JSON.parse(raw), null, 1);
		} catch {
			return raw;
		}
	}

	/** Turns still carrying `resultChars` were recorded while results were cut at 2KB; they
	 *  say so rather than presenting a fragment as the whole thing. */
	function detailChars(tool: AssistantToolResult): string {
		const shown = typeof tool.resultPreview === 'string' ? tool.resultPreview.length : 0;
		const total = typeof tool.resultChars === 'number' ? tool.resultChars : shown;
		return total > shown ? `cut · ${shown.toLocaleString()} of ${total.toLocaleString()} chars` : `${total.toLocaleString()} chars`;
	}
</script>

{#snippet toolRow(tool: AssistantToolResult, i: number, messageId: string | null)}
	{#if tool.diff && !tool.error}
		<AssistantDiffInline
			action={tool}
			icon={toolIcon(tool)}
			navigable={isNavigable(tool)}
			onNavigate={() => navigateToTool(tool)}
			onExpand={() => (activeDiff = tool)}
		/>
	{:else}
		{@const detailKey = `${messageId ?? 'live'}:${i}`}
		{@const open = !!openDetails[detailKey]}
		<div class="assistant-step">
			<div class="assistant-action-row">
				{#if isNavigable(tool)}
					<button type="button" class="assistant-action assistant-action--nav" onclick={() => navigateToTool(tool)} title="Go to this in the app">
						<Icon name={toolIcon(tool)} class="w-3.5 h-3.5 shrink-0 assistant-action-icon" />
						<span class="assistant-action-navlabel">{tool.label}</span>
						<Icon name="arrowRight" class="w-3 h-3 shrink-0 assistant-action-go" />
					</button>
				{:else}
					<div class="assistant-action" class:assistant-action--error={!!tool.error}>
						<Icon name={toolIcon(tool)} class="w-3.5 h-3.5 shrink-0 assistant-action-icon" />
						<span>{tool.error ? `${tool.type}: ${tool.error}` : tool.label}</span>
					</div>
				{/if}
				{#if hasDetail(tool)}
					<button
						type="button"
						class="assistant-expand-btn"
						onclick={() => (openDetails[detailKey] = !open)}
						title={open ? 'Hide call details' : 'Show what this call sent and returned'}
						aria-label="Toggle call details"
						aria-expanded={open}
					>
						<Icon name={open ? 'chevronDown' : 'chevronRight'} class="w-3 h-3" />
					</button>
				{/if}
			</div>
			{#if open}
				<div class="assistant-step-detail">
					{#if tool.args != null}
						<div class="assistant-step-detail-head">arguments</div>
						<pre class="assistant-step-detail-pre">{JSON.stringify(tool.args, null, 1)}</pre>
					{/if}
					{#if typeof tool.resultPreview === 'string'}
						<div class="assistant-step-detail-head">result · {detailChars(tool)}</div>
						<pre class="assistant-step-detail-pre">{formatResult(tool.resultPreview)}</pre>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet stepList(steps: AssistantStep[], liveTurn: boolean, messageId: string | null)}
	{#each groupSteps(steps) as unit (unit.kind === 'batch' ? `b${unit.start}` : `s${unit.index}`)}
		{#if unit.kind === 'batch'}
			{@const batchKey = `${messageId ?? 'live'}:${unit.start}`}
			{@const open = !!openBatches[batchKey]}
			{@const failed = unit.items.reduce((n, it) => n + (it.step.tool.error ? 1 : 0), 0)}
			<div class="assistant-batch">
				<button
					type="button"
					class="assistant-batch-head"
					onclick={() => (openBatches[batchKey] = !open)}
					aria-expanded={open}
					title={open ? 'Collapse this batch' : 'Expand to see each action'}
				>
					<Icon name={open ? 'chevronDown' : 'chevronRight'} class="w-3.5 h-3.5 shrink-0" />
					<span class="assistant-batch-count">{unit.items.length} actions</span>
					{#if failed}<span class="assistant-batch-fail">{failed} failed</span>{/if}
					{#if !open}
						<span class="assistant-batch-latest">{unit.items[unit.items.length - 1].step.tool.label}</span>
					{/if}
				</button>
				{#if open}
					<div class="assistant-batch-items">
						{#each unit.items as it (it.index)}
							{@render toolRow(it.step.tool, it.index, messageId)}
						{/each}
					</div>
				{/if}
			</div>
		{:else if unit.step.kind === 'tool'}
			{@render toolRow(unit.step.tool, unit.index, messageId)}
		{:else if unit.step.kind === 'thinking'}
			<!-- Reasoning stops the moment a tool call starts streaming: the running row owns
			     the live indicator from there, so this block never pulses alongside it. -->
			<AssistantThinking text={unit.step.text} live={liveTurn && !runtime.running.length && unit.index === steps.length - 1} />
		{:else if unit.step.text.trim()}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown -->
			<div class="assistant-text assistant-prose prose">{@html renderMarkdown(unit.step.text)}</div>
		{/if}
	{/each}
{/snippet}

{#each messages as message, mi (message.id)}
	{#if message.role === 'user'}
		<div class="assistant-row assistant-row--user">
			<div class="assistant-user-stack">
				{#if message.attachments?.length}
					<!-- What rode with this message, as the server resolved it, in the same chip
					     language the composer speaks: solid means content went, dashed means a
					     pointer went. The tag word states the mode outright. -->
					<div class="assistant-sent-chips">
						{#each message.attachments as att (`${att.kind}:${att.refId}`)}
							<button
								type="button"
								class="assistant-sent-chip assistant-sent-chip--{att.mode}"
								onclick={() => goToAttachment(att)}
								title={MODE_HINTS[att.mode]}
								aria-label="{att.label}, {MODE_TAGS[att.mode]}. Go to this in the app."
							>
								<Icon name={attachmentKindIcon(att.kind, att.entryType)} class="w-3 h-3 shrink-0" />
								<span class="assistant-sent-chip-label">{att.label}</span>
								<span class="assistant-sent-chip-mode">{MODE_TAGS[att.mode]}</span>
							</button>
						{/each}
					</div>
				{/if}
				<!-- Files that rode this turn. Always a pointer chip: a file's content never
				     goes inline, the assistant reads it with the file tools, so there is no
				     mode to state, only what it is and how long. Clicking opens it. -->
				{#if activeId && store.filesOfMessage(activeId, message.id).length}
					<div class="assistant-sent-chips">
						{#each store.filesOfMessage(activeId, message.id) as file (file.id)}
							<button
								type="button"
								class="assistant-sent-chip assistant-sent-chip--pointer"
								onclick={() => onOpenFile(file)}
								title="{fileKindLabel(file.kind)} · {file.lines} lines · ~{file.tokenEstimate} tokens"
								aria-label="{file.name}, attached file. Open it."
							>
								<Icon name="document" class="w-3 h-3 shrink-0" />
								<span class="assistant-sent-chip-label">{file.name}</span>
								<span class="assistant-sent-chip-mode">{file.lines} lines</span>
							</button>
						{/each}
					</div>
				{/if}
				<div class="assistant-bubble assistant-bubble--user">
					{#if message.images?.length}
						<div class="assistant-msg-images">
							{#each message.images as path, i (path)}
								<button
									type="button"
									class="assistant-msg-image"
									onclick={() => openImage(message.id, i)}
									title="View full size"
								>
									<img src={imageService.thumbnailUrl(path)} alt="Attachment" loading="lazy" />
								</button>
							{/each}
						</div>
					{/if}
					{#if message.content}
						<div class="assistant-text">{message.content}</div>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<!-- The assistant runs a loop, so its turn is a bubble-less, chronological timeline. -->
		<div class="assistant-turn">
			{@render stepList(messageSteps(message), false, message.id)}
			{#if message.status === 'interrupted'}
				<!-- Deliberately no Retry: the actions above already happened, so re-running
				     the turn would repeat them. Ask again for whatever is missing. -->
				<div class="assistant-interrupted">
					The server stopped while this turn was running. Everything above already happened.
				</div>
			{/if}
			{#if message.error}
				<div class="assistant-error">{message.error}</div>
				{#if mi === messages.length - 1 && activeId && !runtime.busy}
					<button type="button" class="assistant-retry-btn" onclick={onRetry}>
						<Icon name="refresh" class="w-3.5 h-3.5" />
						Retry
					</button>
				{/if}
			{/if}
		</div>
	{/if}
{/each}

{#if activeId && !runtime.busy && store.canContinue(activeId)}
	<button type="button" class="assistant-retry-btn" onclick={onContinue} title="The last turn stopped at its budget, resume the unfinished work">
		<Icon name="arrowRight" class="w-3.5 h-3.5" />
		Continue
	</button>
{/if}

{#if runtime.busy}
	<div class="assistant-turn">
		{@render stepList(runtime.steps, true, null)}
		<!-- Tool calls the model is still writing. Same row furniture as a finished action, in
		     the place that action will occupy: the row matures where it stands instead of
		     being replaced by a second one when the result lands. -->
		{#each runtime.running as call (call.index)}
			<!-- Only a call with text to show earns a row. Short arguments (ids, enums, a name)
			     deliberately derive no line, and a row for one of those is a bare tool name
			     saying what the activity line below already says and the settled step is about
			     to say properly. -->
			{#if call.text}
				<div class="assistant-action">
					<!-- The same icon this row keeps once its result lands: the row is content, and
					     nothing about it moves. Its liveness is the activity line's job, below. -->
					<Icon name={toolIcon({ type: call.name })} class="w-3.5 h-3.5 shrink-0 assistant-action-icon" />
					<span class="assistant-action-name">{call.name}</span>
					<!-- aria-hidden: this text is rewritten several times a second, and announcing it
					     would machine-gun a screen reader. The tool's name carries the meaning, and
					     the finished row states what the call actually did. -->
					<span class="assistant-live-args" aria-hidden="true"><span>{call.text}</span></span>
				</div>
			{/if}
		{/each}
		<!-- The turn's one live element, for the whole turn: what is happening, and whether
		     anything is still arriving. Never conditional: a turn always has a state. -->
		<AssistantActivityLine {runtime} />
	</div>
{:else if messages.length}
	<!-- Nothing running. The panel keeps a presence at its foot either way, and whether it
	     moves is the whole message: a turn animates, a settled conversation sits still.
	     It states nothing a reader needs, so it is hidden rather than announced. -->
	<div class="assistant-idle" aria-hidden="true">
		<AssistantWorkMotion motion="idle" still />
	</div>
{/if}

<AssistantDiffModal action={activeDiff} onClose={() => (activeDiff = null)} />
<ImageLightbox
	images={roster.images}
	bind:index={viewerIndex}
	alt="Assistant attachment"
	countLabel="Attachment"
	onClose={() => (viewerIndex = null)}
/>

<style>
	.assistant-row {
		display: flex;
		justify-content: flex-start;
	}

	.assistant-row--user {
		justify-content: flex-end;
	}

	.assistant-bubble {
		max-width: 85%;
		padding: 0.5rem 0.72rem;
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 92%, transparent);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--color-text-primary);
		word-break: break-word;
	}

	.assistant-bubble--user {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
	}

	/* ===== Chips on a sent message (what rode along, as the server resolved it) ===== */

	/* The stack owns the bubble's old width cap so chips and bubble share one right edge. */
	.assistant-user-stack {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.3rem;
		max-width: 85%;
	}

	.assistant-user-stack > .assistant-bubble {
		max-width: 100%;
	}

	.assistant-sent-chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	/* The composer chips' size and shape, so a chip staged there is recognisably the same
	   chip here. Always fully visible: the mode tag is text, never a hover reveal. */
	.assistant-sent-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		max-width: 14rem;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.68rem;
		cursor: pointer;
		transition: background-color 120ms ease, border-color 120ms ease;
	}

	.assistant-sent-chip:hover {
		background: color-mix(in srgb, var(--color-accent) 24%, transparent);
	}

	/* Sent in full: the composer's solid hand-added look, because content actually went. */
	.assistant-sent-chip--full {
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-text-primary);
	}

	/* Pointed at: the composer's dashed ghost look, because an id went, not the content. */
	.assistant-sent-chip--pointer {
		border: 1px dashed color-mix(in srgb, var(--color-accent) 38%, transparent);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
		color: var(--color-text-secondary);
	}

	/* Clipped: content went, but not all of it, so solid like a send, marked like a shortfall. */
	.assistant-sent-chip--clipped {
		border: 1px solid color-mix(in srgb, var(--color-warning) 50%, transparent);
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		color: var(--color-text-primary);
	}

	/* Too long: a pointer wearing a warning, because less went than the user asked for. */
	.assistant-sent-chip--oversize {
		border: 1px dashed color-mix(in srgb, var(--color-warning) 55%, transparent);
		background: color-mix(in srgb, var(--color-warning) 8%, transparent);
		color: var(--color-text-secondary);
	}

	/* Already in context: solid (the assistant HAS the content), just quieter than a send. */
	.assistant-sent-chip--known {
		border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		color: var(--color-text-secondary);
	}

	.assistant-sent-chip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.assistant-sent-chip-mode {
		flex-shrink: 0;
		font-size: 0.56rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.assistant-sent-chip--oversize .assistant-sent-chip-mode,
	.assistant-sent-chip--clipped .assistant-sent-chip-mode {
		color: var(--color-warning);
	}

	.assistant-text {
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Assistant turn: bubble-less, full-width timeline of text + tool steps in order. The
	   base gap is the tight "tool log" rhythm; prose lifts itself out with extra margin. */
	/* Same rail and the same breathing room the activity line takes, so the mark does not
	   jump sideways or upward when a turn ends and one replaces the other. */
	.assistant-idle {
		display: flex;
		padding: 0 0.45rem;
		margin-top: 0.35rem;
		color: color-mix(in srgb, var(--color-accent) 60%, var(--color-text-muted));
	}

	.assistant-turn {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--color-text-primary);
		word-break: break-word;
	}

	/* The assistant actually talking to the user: set apart from the tool log with a quiet
	   accent rule, airier type, and real breathing room, so prose reads as speech and
	   never blurs into the run of tool-call rows around it. */
	.assistant-turn > .assistant-text {
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
		padding-left: 0.6rem;
		margin: 0.45rem 0;
		font-size: 0.82rem;
		line-height: 1.6;
		color: var(--color-text-primary);
	}

	/* Tool-call rows are metadata, not message: muted, dense, neutral. They recede so
	   the prose carries the eye, and a run of them tucks together as a single log. */
	.assistant-action {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		padding: 0.22rem 0.45rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
	}

	/* Markdown prose: kill the plain-text pre-wrap (marked already emits <p>/<br>) and
	   keep block spacing tight inside the narrow panel. */
	.assistant-prose {
		white-space: normal;
	}

	.assistant-prose :global(p) {
		margin: 0.4rem 0;
	}

	.assistant-prose :global(p:first-child) {
		margin-top: 0;
	}

	.assistant-prose :global(p:last-child) {
		margin-bottom: 0;
	}

	.assistant-prose :global(ul),
	.assistant-prose :global(ol) {
		margin: 0.35rem 0;
		padding-left: 1.1rem;
	}

	.assistant-prose :global(li) {
		margin: 0.1rem 0;
	}

	.assistant-prose :global(h1),
	.assistant-prose :global(h2),
	.assistant-prose :global(h3) {
		font-size: 0.86rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem;
	}

	.assistant-prose :global(code) {
		font-size: 0.78em;
	}

	.assistant-action :global(svg.assistant-action-icon) {
		margin-top: 0.1rem;
		color: color-mix(in srgb, var(--color-accent) 60%, var(--color-text-muted));
	}

	/* Tool actions with a place to go are clickable and navigate there. They keep the
	   muted log look of a plain action row, just clickable. */
	.assistant-action--nav {
		width: 100%;
		border: none;
		font-family: inherit;
		cursor: pointer;
	}

	.assistant-action--nav:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-text-secondary);
	}

	.assistant-action-navlabel {
		flex: 1;
		min-width: 0;
	}

	.assistant-action--nav :global(svg.assistant-action-go) {
		color: var(--color-text-muted);
	}

	.assistant-action--error {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		color: var(--color-error);
	}

	/* ===== A tool call whose arguments are still streaming ===== */

	/* The row shrinks its own name before it lets the ticker push anything sideways, so a
	   long tool name in a narrow panel ellipsizes instead of widening the timeline. */
	.assistant-action-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* One clipped line of what the model is writing right now, newest text kept in view. Its
	   footprint is fixed by construction (never wrapped, never grown), so the ~7 frames a
	   second cannot resize the row or shift a single pixel of the timeline below it.
	   row-reverse packs the text against the right edge and lets the old head overflow past
	   the left one, where the mask fades it out: the clip reads as text feeding through
	   rather than as a hard cut. */
	.assistant-live-args {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: row-reverse;
		overflow: hidden;
		white-space: nowrap;
		color: var(--color-text-muted);
		-webkit-mask-image: linear-gradient(to right, transparent, black 2rem);
		mask-image: linear-gradient(to right, transparent, black 2rem);
	}

	.assistant-live-args > span {
		flex: 0 0 auto;
	}

	/* A tool row + its expand affordance side by side; the chevron only shows on
	   hover so the log stays quiet. */
	.assistant-action-row {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
	}

	.assistant-step {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	/* Quiet until pointed at (row furniture, not chrome), but never invisible to
	   keyboard focus, and always visible on coarse pointers, where hover does not
	   exist (the lorebook recipe). */
	.assistant-expand-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms ease, background-color 120ms ease;
	}

	.assistant-action-row:hover .assistant-expand-btn,
	.assistant-action-row:focus-within .assistant-expand-btn,
	.assistant-expand-btn:focus-visible {
		opacity: 1;
	}

	@media (pointer: coarse) {
		.assistant-expand-btn {
			opacity: 1;
		}
	}

	.assistant-expand-btn:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-primary);
	}

	/* What a call sent and returned: mono, bounded, scrolls inside itself. */
	.assistant-step-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-left: 0.45rem;
		padding: 0.4rem 0.55rem;
		border-left: 2px solid color-mix(in srgb, var(--color-text-muted) 25%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 30%, transparent);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.assistant-step-detail-head {
		font-size: 0.62rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.assistant-step-detail-pre {
		margin: 0;
		max-height: 14rem;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.assistant-action-row > .assistant-action {
		flex: 1;
		min-width: 0;
	}

	/* ===== Batched actions (a run of tool calls from one step, collapsed) ===== */

	.assistant-batch {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
		overflow: hidden;
	}

	.assistant-batch-head {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.6rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		text-align: left;
		cursor: pointer;
	}

	.assistant-batch-head:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		color: var(--color-text-primary);
	}

	.assistant-batch-count {
		font-weight: 600;
		white-space: nowrap;
	}

	.assistant-batch-fail {
		color: var(--color-error);
		font-weight: 600;
		white-space: nowrap;
	}

	.assistant-batch-latest {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.assistant-batch-items {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.45rem 0.6rem 0.55rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.assistant-retry-btn {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		cursor: pointer;
	}

	.assistant-retry-btn:hover {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.assistant-action--error :global(svg.assistant-action-icon) {
		color: var(--color-error);
	}

	.assistant-error {
		font-size: 0.76rem;
		color: var(--color-error);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.assistant-interrupted {
		font-size: 0.76rem;
		color: var(--color-text-muted);
		border-left: 2px solid var(--color-border-subtle);
		padding-left: 0.5rem;
		word-break: break-word;
	}


	.assistant-msg-images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.assistant-msg-images + .assistant-text {
		margin-top: 0.35rem;
	}

	.assistant-msg-image {
		display: block;
		width: 5.5rem;
		max-width: 45%;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: zoom-in;
		background: color-mix(in srgb, var(--color-bg-tertiary) 50%, transparent);
	}

	.assistant-msg-image img {
		display: block;
		width: 100%;
		height: auto;
	}
</style>
