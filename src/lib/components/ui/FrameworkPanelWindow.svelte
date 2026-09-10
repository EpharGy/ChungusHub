<script lang="ts">
	/**
	 * The frameworks panel: every marker in play, and what each one is doing right now.
	 *
	 * It exists because a feature whose effect can be an ABSENCE is invisible without it. A
	 * marker that was stripped and a character who was never tracked look identical in a
	 * prompt: a line that is not there. Every strip is recorded with a reason, and this is the
	 * only place those reasons reach a screen.
	 *
	 * Everything shown is derived fresh through the REAL dispatcher (`frameworks/panel.ts`),
	 * never a second reading of the markers, so a row cannot claim an outcome the prompt did
	 * not produce.
	 *
	 * What it deliberately does NOT answer is "why did she not appear in this turn". These rows
	 * cover every marker in the books this chat carries, whether or not its entry fired; whether
	 * an entry fired is the lorebook's own trace to explain. The heading says so, because a
	 * reader who took a row here as proof the line reached the model would be wrong.
	 *
	 * Shares its shell with the notepad and the image pop-out (`FloatingWindow`), and has a
	 * launcher (`/frameworks`), so closing is cheap and the X is not destructive.
	 */
	import FloatingWindow from './FloatingWindow.svelte';
	import Icon from './Icon.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { lorebookStore } from '$lib/lorebook/store.svelte';
	import { frameworkPanelStore } from '$lib/stores/frameworkPanel.svelte';
	import {
		chatFrameworkState,
		chatLorebookClaim,
		chatMutedLorebookClaim,
		chatPersonaEntry
	} from '$lib/utils/chat-setup';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { FRAMEWORKS } from '$lib/frameworks/registry';
	import { runningFrameworks } from '$lib/frameworks/apply';
	import { requiredBy } from '$lib/frameworks/chat-state';
	import { DATE_FRAMEWORK_ID, normalizeDateChatState } from '$lib/frameworks/date';
	import { frameworkSettingsStore } from '$lib/stores/frameworkSettings.svelte';
	import { panelView, ROW_STATUS, type PanelBook, type PanelRow } from '$lib/frameworks/panel';
	import { normalizeSubjectKey } from '$lib/frameworks/marker';
	import { parseDayArg } from '$lib/frameworks/chat-state';
	import { formatDate } from '$lib/frameworks/day';
	import { lorebookWasInjected } from '$lib/lorebook/types';
	import { buildLiveMacroContext } from '$lib/utils/live-macro-context';
	import { memoryStore } from '$lib/memory/store.svelte';

	frameworkPanelStore.restore();

	/**
	 * The framework id in the empty state's example marker, taken from the registry rather than
	 * written out.
	 *
	 * A hardcoded one was wrong twice over: it named a framework a given build may not carry,
	 * so the example could suggest a marker that would never resolve, and it tied a generic
	 * panel to one framework's vocabulary. The first framework that answers markers is the one
	 * to show, because a framework that only injects has no marker to write.
	 */
	let exampleId = $derived(FRAMEWORKS.find((f) => f.compute)?.id ?? 'framework');

	let chat = $derived(chatStore.currentChatState?.chat ?? null);
	// NOT named `state`: a binding by that name in this file makes Svelte read the `$state`
	// rune below as store access on it, and the error it produces names the store, not the rune.
	let frameworkState = $derived(chatFrameworkState(chat));

	/** The frameworks running in THIS chat: available on the install and turned on by the
	 *  story. The same intersection the prompt does, through the same function, so the panel
	 *  cannot describe a set the send does not use. */
	let running = $derived(
		frameworkState ? runningFrameworks(frameworkState, frameworkSettingsStore.settings) : []
	);

	// The card sheet this chat PLAYS carries its linked books, not the library's active
	// variant (architecture/prompt-pipeline.md 3b). Null while a pin names nothing, which the
	// setup chip is the place to repair.
	let entry = $derived(
		chat?.characterId ? characterLibraryStore.entries.find((e) => e.id === chat.characterId) ?? null : null
	);
	let playedCard = $derived(
		entry ? characterLibraryStore.dataForVersion(entry, chat?.characterVersionId ?? null) : null
	);
	let persona = $derived(chatPersonaEntry(chat));

	/** Resolved the way the send resolves them, so the panel reads the same shelf. */
	let books = $derived(
		lorebookStore.booksForChat({
			cards: [...(playedCard?.lorebookIds ?? []), ...(persona?.data.lorebookIds ?? [])],
			chat: chatLorebookClaim(chat),
			muted: chatMutedLorebookClaim(chat)
		})
	);

	/**
	 * Entry ids whose text reached the prompt, from a LIVE scan rather than the trace stored on
	 * the last turn: the answer has to move when a book is edited or a subject held out, and a
	 * stored trace describes a prompt that was already sent.
	 *
	 * It goes through `buildLiveMacroContext`, which is the same builder the token meters use,
	 * so the panel cannot select differently from the block sitting beside it. Which statuses
	 * count is `lorebookWasInjected`, the lorebook's own answer.
	 *
	 * Null when the filter is off, and null while the window is shut so a closed panel costs
	 * nothing: this runs a full scan, expands macros and counts tokens.
	 */
	let injectedEntryIds = $derived.by(() => {
		if (!frameworkPanelStore.onlyFired || !frameworkPanelStore.open || !chat) return null;
		const trace = buildLiveMacroContext({ memory: memoryStore.recall }).lorebookTrace;
		const ids = new Set<string>();
		for (const record of trace?.records ?? []) {
			if (lorebookWasInjected(record.status)) ids.add(record.entryId);
		}
		return ids;
	});

	let view = $derived(
		panelView({
			books,
			frameworks: FRAMEWORKS,
			// Both switches, resolved the way the prompt resolves them, so a row that says
			// `disabled` here means the same thing it would mean in the send.
			disabled: FRAMEWORKS.map((f) => f.id).filter((id) => !running.includes(id)),
			state: frameworkState,
			injectedEntryIds
		})
	);

	/** Where the day came from, said plainly. A reader on real time needs to know `/day` will
	 *  not move it, which is otherwise a silent no-op, and a reader on manual needs to know the
	 *  clock is not being read at all. */
	let daySource = $derived(
		view.day.source === 'manual' ? 'set by hand, click to change' : "today's date"
	);

	let storyDecides = $derived(view.day.source !== 'manual');

	/**
	 * The day in the unit its own source speaks.
	 *
	 * Marker mode resolves to a serial counted from year 1, which is correct and unreadable:
	 * an ordinary 2026 date shows as 739865. Rendering it back as a date is the exact inverse
	 * of the parse that produced it (`formatDate`), so the panel names the day the story is on
	 * rather than the arithmetic behind it.
	 *
	 * **Both marker-mode sources are dates**, and missing that is an easy bug: `clock` and
	 * `time-marker` differ only in which date won, so converting one and not the other would
	 * print `Day 739889` at a reader for every turn the story keeps step with the clock, which
	 * is most of them. Only `manual` is a story day the author chose, where 47 means the
	 * forty-seventh day and not the year 1 plus 47.
	 */
	let dayLabel = $derived(
		view.day.source === 'manual' ? `Day ${view.day.day}` : formatDate(view.day.day)
	);

	/** The serial stays reachable on hover: it is what a cycle is actually counted against,
	 *  so anyone checking the arithmetic by hand needs it, and nobody else does. */
	let dayTitle = $derived(
		view.day.source === 'manual' ? '' : `Day ${view.day.day}, counted from 0001-01-01`
	);

	/**
	 * Every framework, with what each switch says about it, ordered so the ones this chat can
	 * actually use come first.
	 *
	 * The unavailable ones are shown rather than hidden, greyed at the bottom: a framework that
	 * simply vanished would leave a reader hunting Settings for something they were not sure
	 * existed. Saying "off for the whole app" is one line and answers the question.
	 */
	let chatFrameworks = $derived(
		[...FRAMEWORKS]
			.map((def) => ({
				def,
				available: frameworkSettingsStore.isAvailable(def.id),
				on: running.includes(def.id)
			}))
			.sort((a, b) => Number(b.available) - Number(a.available))
	);

	/** The date framework's own per-chat slice, normalized by the framework that owns it. */
	let dateState = $derived(
		normalizeDateChatState(frameworkState?.byFramework?.[DATE_FRAMEWORK_ID])
	);

	let dateOn = $derived(running.includes(DATE_FRAMEWORK_ID));

	async function patchChat(patch: Partial<typeof frameworkState>) {
		if (!chat || !frameworkState) return;
		await chatStore.updateChatFeatureState(chat.id, { frameworks: { ...frameworkState, ...patch } });
	}

	/**
	 * Turn a framework on or off for THIS chat.
	 *
	 * Turning one on pulls in what it requires, and turning one off is refused while something
	 * that needs it is on. The stored list is closed over on read anyway, so this is not what
	 * makes the rule true; it is what makes the switch explain itself instead of appearing to
	 * do nothing.
	 */
	async function toggleFramework(id: string, value: boolean) {
		if (!frameworkState) return;
		const current = frameworkState.enabled;
		if (!value) {
			const blockers = requiredBy(id, running);
			if (blockers.length > 0) {
				const names = blockers.map((b) => FRAMEWORKS.find((f) => f.id === b)?.name ?? b);
				toastStore.error(`${names.join(', ')} needs this. Turn that off first.`);
				return;
			}
			await patchChat({ enabled: current.filter((k) => k !== id) });
			return;
		}
		const needed = FRAMEWORKS.find((f) => f.id === id)?.requires ?? [];
		await patchChat({ enabled: [...new Set([...current, id, ...needed])] });
	}

	async function setShape(shape: 'visible' | 'hidden') {
		if (!frameworkState) return;
		await patchChat({
			byFramework: { ...frameworkState.byFramework, [DATE_FRAMEWORK_ID]: { shape } }
		});
	}

	let editing = $state(false);
	let draft = $state('');

	function startEdit() {
		draft = String(view.day.day);
		editing = true;
	}

	/** Focus and select on mount, so the number can be typed over rather than cleared first.
	 *  An action rather than an attachment, which is the idiom the rest of this folder uses. */
	function takeFocus(el: HTMLInputElement) {
		el.focus();
		el.select();
	}

	function onDayKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void commit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			// Straight out, uncommitted. Unmounting the input fires blur, which commit()
			// then declines because `editing` is already false.
			editing = false;
		}
	}

	async function commit() {
		if (!editing || !chat) return;
		editing = false;
		// The same parser `/day` uses, so "+3" works in the box for the reason it works in the
		// command, and the story-day cap is applied in exactly one place.
		const day = parseDayArg(draft, frameworkState.day);
		if (day === null) {
			toastStore.error(`"${draft.trim()}" is not a day. Try 42, +1 or -1.`);
			return;
		}
		if (day === frameworkState.day) return;
		await chatStore.updateChatFeatureState(chat.id, { frameworks: { ...frameworkState, day } });
	}

	async function step(by: number) {
		if (!chat) return;
		await chatStore.updateChatFeatureState(chat.id, {
			frameworks: { ...frameworkState, day: frameworkState.day + by }
		});
	}

	function toggleBook(bk: PanelBook) {
		frameworkPanelStore.toggleBook(bk.bookId);
	}

	async function toggleSuppressed(row: PanelRow) {
		if (!chat || !row.key) return;
		const key = normalizeSubjectKey(row.key);
		const held = frameworkState.suppressed.includes(key);
		await chatStore.updateChatFeatureState(chat.id, {
			frameworks: {
				...frameworkState,
				suppressed: held ? frameworkState.suppressed.filter((k) => k !== key) : [...frameworkState.suppressed, key]
			}
		});
	}
</script>

<FloatingWindow
	open={frameworkPanelStore.open}
	storageKey="framework-panel-rect"
	ariaLabel="Frameworks"
	defaultSize={{ w: 520, h: 480 }}
	minSize={{ w: 340, h: 260 }}
	onHide={() => frameworkPanelStore.set(false)}
	hideLabel="Hide the window"
>
	{#snippet header()}
		<span class="fp-title"><Icon name="clock" class="w-4 h-4" /> Frameworks</span>
	{/snippet}

	{#snippet children()}
		<div class="fp-body">
			{#if !chat}
				<p class="fp-empty">Open a chat to see what its frameworks are doing.</p>
			{:else}
				<section class="fp-uses">
					<h4 class="fp-h">In this chat</h4>
					{#each chatFrameworks as row (row.def.id)}
						<label class="fp-use" class:is-unavailable={!row.available}>
							<input
								type="checkbox"
								checked={row.on}
								disabled={!row.available}
								onchange={(e) => toggleFramework(row.def.id, e.currentTarget.checked)}
							/>
							<span class="fp-use-text">
								<span class="fp-use-name">{row.def.name}</span>
								<span class="fp-dim">
									{row.available ? row.def.summary : 'Off for the whole app, in Settings > Frameworks'}
								</span>
							</span>
						</label>
					{/each}
				</section>

				{#if dateOn}
					<section class="fp-uses">
						<h4 class="fp-h">Time</h4>
						<div class="fp-seg">
							<button
								class:is-on={frameworkState?.mode === 'marker'}
								onclick={() => patchChat({ mode: 'marker' })}>Real time</button
							>
							<button
								class:is-on={frameworkState?.mode !== 'marker'}
								onclick={() => patchChat({ mode: 'manual' })}>Manual</button
							>
						</div>
						{#if frameworkState?.mode === 'marker'}
							<span class="fp-dim">
								The model is told the real time each turn, and asked to write it back so you can
								see it. Nothing reads that marker: it is for you.
							</span>
							<div class="fp-seg">
								<button
									class:is-on={dateState.shape === 'visible'}
									onclick={() => setShape('visible')}>Marker visible</button
								>
								<button
									class:is-on={dateState.shape === 'hidden'}
									onclick={() => setShape('hidden')}>Hidden</button
								>
							</div>
						{:else}
							<span class="fp-dim">
								The day is yours to set, below. Nothing reads the clock.
							</span>
						{/if}
					</section>
				{/if}

				<div class="fp-day">
					<div class="fp-day-said">
						{#if storyDecides}
							<strong class="fp-daynum" title={dayTitle}>{dayLabel}</strong>
						{:else if editing}
							<input
								class="fp-dayinput"
								bind:value={draft}
								onkeydown={onDayKey}
								onblur={commit}
								aria-label="Story day"
								use:takeFocus
							/>
						{:else}
							<button class="fp-daynum fp-dayedit" onclick={startEdit} title="Set the story day">
								{dayLabel}<Icon name="pencil" class="w-3 h-3" />
							</button>
						{/if}
						<span class="fp-dim">{daySource}</span>
					</div>
					{#if storyDecides}
						<span class="fp-dim">The story sets this, so <code>/day</code> will not move it.</span>
					{:else}
						<div class="fp-steps">
							<button onclick={() => step(-1)} aria-label="Previous day">&minus;</button>
							<button onclick={() => step(1)} aria-label="Next day">+</button>
						</div>
					{/if}
				</div>

				<label class="fp-filter">
					<input
						type="checkbox"
						checked={frameworkPanelStore.onlyFired}
						onchange={(e) => frameworkPanelStore.setOnlyFired(e.currentTarget.checked)}
					/>
					Only entries that reached the prompt
				</label>

				{#if view.books.length === 0}
					<p class="fp-empty">
						{#if frameworkPanelStore.onlyFired}
							No markers in the entries that reached the prompt. Untick above to see every marker
							in this chat's books, which is where a marker whose entry never fires shows up.
						{:else}
							No markers in the books this chat carries. Add one to a character's lorebook entry,
							like <code>@{exampleId}[Her Name]</code>.
						{/if}
					</p>
				{:else}
					<p class="fp-note">
						{#if frameworkPanelStore.onlyFired}
							What the model is being told right now: markers in the entries that reached the
							prompt on this turn.
						{:else}
							Every marker in this chat's books, whether or not its entry fired this turn. Whether
							an entry fired is the lorebook's own trace to answer.
						{/if}
					</p>
					{#each view.books as bk (bk.bookId)}
						{@const folded = frameworkPanelStore.isCollapsed(bk.bookId)}
						<section class="fp-book">
							<button class="fp-bookhead" onclick={() => toggleBook(bk)} aria-expanded={!folded}>
								<Icon name={folded ? 'chevronRight' : 'chevronDown'} class="w-3 h-3" />
								<span class="fp-bookname">{bk.bookName}</span>
								<span class="fp-count">{bk.rows.length}</span>
							</button>
							{#if !folded}
								<ul class="fp-rows">
									<!-- Keyed on position within the book rather than on the marker text: an entry
									     may legitimately carry the same marker twice, and a duplicate key is a
									     runtime error where a re-render is merely a re-render of static text. -->
									{#each bk.rows as row, i (bk.bookId + i)}
										<li class="fp-row" class:fp-bad={row.status === 'malformed' || row.status === 'unknownFramework'}>
											<div class="fp-head">
												<strong>{row.subject ?? row.raw}</strong>
												<span class="fp-status">{ROW_STATUS[row.status]}</span>
												{#if row.key}
													<button class="fp-hold" onclick={() => toggleSuppressed(row)}>
														{frameworkState.suppressed.includes(normalizeSubjectKey(row.key)) ? 'Include' : 'Hold out'}
													</button>
												{/if}
											</div>
											{#if row.text}
												<p class="fp-line">{row.text}</p>
											{:else if row.reason}
												<p class="fp-reason">{row.reason} &mdash; <code>{row.raw}</code></p>
											{/if}
											<p class="fp-where">{row.entryTitle || 'Untitled entry'}</p>
										</li>
									{/each}
								</ul>
							{/if}
						</section>
					{/each}
				{/if}
			{/if}
		</div>
	{/snippet}
</FloatingWindow>

<style>
	.fp-title {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
	}
			.fp-body {
		padding: 0.75rem;
		overflow-y: auto;
		height: 100%;
		font-size: 0.85rem;
	}
	.fp-empty,
	.fp-note {
		color: var(--color-text-secondary, #888);
		margin: 0 0 0.75rem;
	}
	.fp-note {
		font-size: 0.78rem;
	}
	.fp-uses {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.6rem;
	}

	.fp-h {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 640;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.fp-use {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: 0.45rem;
		cursor: pointer;
	}

	.fp-use.is-unavailable {
		cursor: default;
		opacity: 0.55;
	}

	.fp-use-text {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		min-width: 0;
	}

	.fp-use-name {
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--color-text-primary);
	}

	.fp-seg {
		display: flex;
		gap: 0.25rem;
	}

	.fp-seg button {
		flex: 1;
		padding: 0.25rem 0.4rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: transparent;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	.fp-seg button.is-on {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: var(--color-text-primary);
	}

	.fp-day {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-bottom: 0.6rem;
		margin-bottom: 0.6rem;
		border-bottom: 1px solid var(--color-border, #3333);
	}
	.fp-dim {
		color: var(--color-text-secondary, #888);
		margin-left: 0.4rem;
	}
	.fp-day-said {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.1rem;
		min-width: 0;
	}
	.fp-daynum {
		font-weight: 600;
		font-size: 1rem;
		color: inherit;
	}
	/* A button that reads as the heading it replaces, until it is hovered. The pencil is what
	   says it can be typed into; the underline on hover is what confirms it. */
	.fp-dayedit {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
	}
	.fp-dayedit:hover {
		text-decoration: underline;
	}
	.fp-dayinput {
		width: 6.5rem;
		font: inherit;
		font-weight: 600;
		font-size: 1rem;
		padding: 0.05rem 0.3rem;
		color: inherit;
		background: var(--color-surface-2, #0002);
		border: 1px solid var(--color-accent, #6a8);
		border-radius: 0.25rem;
	}
	.fp-steps button {
		min-width: 1.9rem;
		padding: 0.15rem 0.4rem;
		cursor: pointer;
	}
	.fp-filter {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
		cursor: pointer;
		user-select: none;
	}
	.fp-filter input {
		cursor: pointer;
	}
	.fp-book {
		margin-bottom: 0.7rem;
	}
	.fp-bookhead {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.2rem 0;
		background: none;
		border: 0;
		cursor: pointer;
		color: inherit;
		font: inherit;
		text-align: left;
	}
	.fp-bookname {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fp-count {
		margin-left: auto;
		flex: none;
		color: var(--color-text-secondary, #888);
		font-size: 0.72rem;
	}
	.fp-book .fp-rows {
		margin-top: 0.4rem;
		padding-left: 0.35rem;
	}
	.fp-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.fp-row {
		border-left: 2px solid var(--color-accent, #6a8);
		padding-left: 0.6rem;
	}
	.fp-bad {
		border-left-color: var(--color-danger, #c55);
	}
	.fp-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.fp-status {
		color: var(--color-text-secondary, #888);
		font-size: 0.75rem;
	}
	.fp-hold {
		margin-left: auto;
		background: none;
		border: 0;
		cursor: pointer;
		color: var(--color-text-secondary, #888);
		font-size: 0.75rem;
		text-decoration: underline;
	}
	.fp-line,
	.fp-reason,
	.fp-where {
		margin: 0.2rem 0 0;
	}
	.fp-where {
		color: var(--color-text-secondary, #888);
		font-size: 0.72rem;
	}
	.fp-reason {
		color: var(--color-danger, #c55);
	}
</style>
