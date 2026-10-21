<script lang="ts">
	/**
	 * The Chorus panel: the open chat's list of characters, what each said about the newest
	 * reply, and the goals they are working towards, in a floating, dockable window.
	 *
	 * Mounted once at the shell's top level and driven by `chorusStore`. It is also what keeps
	 * the engine running: Chorus feeds the next prompt whether or not anyone is looking, so this
	 * component asks the store to read the newest reply on every change while it draws nothing
	 * at all. The store decides whether that means a call. See architecture/chorus.md.
	 */
	import FloatingWindow from './FloatingWindow.svelte';
	import FloatingPanelButton from './FloatingPanelButton.svelte';
	import Icon from './Icon.svelte';
	import Toggle from './Toggle.svelte';
	import { chorusStore } from '$lib/stores/chorus.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
	import {
		CHORUS_GOAL_KEYS,
		CHORUS_MAX_MEMBERS,
		CHORUS_PRESENT_DEPTH_MAX,
		type ChorusGoalKey
	} from '$lib/chorus/state';

	let chat = $derived(chatStore.currentChatState?.chat ?? null);
	let engineOn = $derived(featurePromptsStore.chorusEnabled);
	let roster = $derived(chorusStore.state);
	let status = $derived(chorusStore.status);
	let running = $derived(chorusStore.active);

	let newName = $state('');

	// Ask on every change; the store decides whether that means a call. Mounted for the app's
	// whole life, so this runs with the window closed too, which is the point.
	$effect(() => {
		chorusStore.ensureRead();
	});

	const GOAL_LABELS: Record<ChorusGoalKey, string> = {
		immediate: 'Now',
		shortTerm: 'Soon',
		longTerm: 'Long term'
	};

	let statusLine = $derived.by((): string => {
		if (!engineOn) return 'Off for the whole app, in Settings > Engines.';
		if (!roster.enabled) return 'Off in this chat.';
		if (!roster.members.some((m) => m.enabled)) return 'Add a character, or switch one on, to start.';
		if (!chorusStore.newestReply) return 'Waiting for a reply to read.';
		if (status === 'opening') return 'The opening is not read. The characters are asked after the first reply.';
		if (status === 'between') {
			const n = chorusStore.repliesUntilRead;
			const next = n === 1 ? 'the next reply' : `${n} replies from now`;
			return chorusStore.currentReading
				? `Not asking about this reply. The last answers still go in, and the characters are asked again after ${next}.`
				: `Not asking about this reply. The characters are asked again after ${next}.`;
		}
		return {
			read: 'Read the newest reply. Their answers go into the next one.',
			reading: 'Asking the characters about the newest reply…',
			failed: 'Some characters did not answer the newest reply.',
			idle: 'Waiting to read the newest reply.'
		}[status];
	});

	function addMember(): void {
		const name = newName.trim();
		if (!name) return;
		newName = '';
		void chorusStore.addMember(name);
	}

	function onAddKey(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			addMember();
		}
	}
</script>

<FloatingWindow
	open={chorusStore.open}
	storageKey="chorus-rect"
	ariaLabel="Chorus"
	defaultSize={{ w: 440, h: 560 }}
	minSize={{ w: 320, h: 260 }}
	onHide={() => chorusStore.set(false)}
	hideLabel="Hide the window"
>
	{#snippet header()}
		<span class="ch-title"><Icon name="users" class="w-4 h-4" /> Chorus</span>
		<FloatingPanelButton
			icon="refresh"
			label="Ask the characters about the newest reply again"
			onclick={() => void chorusStore.runAgain()}
			disabled={!running || status === 'reading' || status === 'opening' || !chorusStore.newestReply}
		/>
	{/snippet}

	{#snippet children()}
		<div class="ch-body">
			{#if !chat}
				<p class="ch-empty">Open a chat to give its characters a voice.</p>
			{:else}
				<label class="ch-switch">
					<Toggle
						checked={roster.enabled}
						onchange={(v) => void chorusStore.setChatEnabled(v)}
						size="sm"
						label="Chorus in this chat"
					/>
					<span class="ch-switch-text">
						<span class="ch-name">On in this chat</span>
						<span class="ch-dim">
							After each reply, every character below is asked what they want. Their answers
							go into the next prompt, and the story uses what fits.
						</span>
					</span>
				</label>

				<div class="ch-switch ch-switch--sub">
					<Toggle
						checked={roster.presentOnly}
						onchange={(v) => void chorusStore.setPresentOnly(v)}
						size="sm"
						label="Only ask characters in the scene"
					/>
					<span class="ch-switch-text">
						<span class="ch-name">Only characters in the scene</span>
						<span class="ch-dim">
							Ask only the characters named in the last
							<input
								class="ch-numinput"
								type="number"
								min="1"
								max={CHORUS_PRESENT_DEPTH_MAX}
								value={roster.presentDepth}
								onchange={(e) => void chorusStore.setPresentDepth(Number(e.currentTarget.value))}
								aria-label="How many messages back to look for a character's name"
							/>
							messages, matched the way lorebook keys are. The others sit this one out.
						</span>
					</span>
				</div>

				<p class="ch-status" class:is-failed={running && status === 'failed'} role="status">
					{#if running && status === 'reading'}<span class="ch-pulse" aria-hidden="true"></span>{/if}
					{statusLine}
				</p>

				<h3 class="ch-h">Characters</h3>

				{#if roster.members.length === 0}
					<p class="ch-dim ch-gap">
						Nobody yet. Use each character's name as their lorebook entry knows it, so their
						entry fires for them.
					</p>
				{/if}

				<ul class="ch-members">
					{#each roster.members as member, i (member.id)}
						{@const answer = chorusStore.answerFor(member.id)}
						{@const goals = chorusStore.goalsFor(member)}
						<li class="ch-member" class:is-off={!member.enabled}>
							<div class="ch-row">
								<Toggle
									checked={member.enabled}
									onchange={(v) => void chorusStore.setMemberEnabled(member.id, v)}
									size="sm"
									label="Ask {member.name}"
								/>
								<input
									class="ch-nameinput"
									value={member.name}
									onchange={(e) => void chorusStore.renameMember(member.id, e.currentTarget.value)}
									aria-label="Name"
									spellcheck="false"
								/>
								<button
									type="button"
									class="ch-icon"
									onclick={() => void chorusStore.moveMember(member.id, -1)}
									disabled={i === 0}
									aria-label="Move {member.name} up"
									title="Move up"
								>
									<Icon name="chevronUp" class="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									class="ch-icon"
									onclick={() => void chorusStore.moveMember(member.id, 1)}
									disabled={i === roster.members.length - 1}
									aria-label="Move {member.name} down"
									title="Move down"
								>
									<Icon name="chevronDown" class="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									class="ch-icon ch-icon--danger"
									onclick={() => void chorusStore.removeMember(member.id)}
									aria-label="Remove {member.name}"
									title="Remove from the list"
								>
									<Icon name="trash" class="w-3.5 h-3.5" />
								</button>
							</div>

							{#if member.enabled && chorusStore.wasSkipped(member.id)}
								<p class="ch-dim ch-answer-note">Not in the scene, so not asked.</p>
							{:else if member.enabled && answer}
								{#if answer.error}
									<p class="ch-answer ch-answer--error">Did not answer: {answer.error}</p>
								{:else}
									<dl class="ch-answer">
										{#if answer.want}<dt>Wants</dt><dd>{answer.want}</dd>{/if}
										{#if answer.intends}<dt>Would</dt><dd>{answer.intends}</dd>{/if}
									</dl>
								{/if}
							{/if}

							<div class="ch-goals">
								{#each CHORUS_GOAL_KEYS as key (key)}
									<div class="ch-goal">
										<span class="ch-goal-label">{GOAL_LABELS[key]}</span>
										<input
											class="ch-goalinput"
											value={goals[key]}
											placeholder="Not set"
											onchange={(e) => void chorusStore.setGoal(member.id, key, e.currentTarget.value)}
											aria-label="{member.name}'s goal: {GOAL_LABELS[key]}"
										/>
										<button
											type="button"
											class="ch-icon"
											class:is-on={member.pinned[key]}
											onclick={() => void chorusStore.setPinned(member, key, !member.pinned[key])}
											aria-pressed={member.pinned[key]}
											aria-label={member.pinned[key]
												? `Unpin, so ${member.name}'s answers can change it`
												: `Pin, so ${member.name}'s answers cannot change it`}
											title={member.pinned[key]
												? 'Pinned: only you change this'
												: 'Pin it, so their answers cannot change it'}
										>
											<Icon name="pin" class="w-3.5 h-3.5" />
										</button>
									</div>
								{/each}
							</div>
						</li>
					{/each}
				</ul>

				{#if roster.members.length < CHORUS_MAX_MEMBERS}
					<div class="ch-add">
						<input
							class="ch-addinput"
							bind:value={newName}
							onkeydown={onAddKey}
							placeholder="Add a character by name"
							aria-label="Character name"
							spellcheck="false"
						/>
						<button type="button" class="ch-addbtn" onclick={addMember} disabled={!newName.trim()}>
							<Icon name="plus" class="w-3.5 h-3.5" /> Add
						</button>
					</div>
				{/if}

				<p class="ch-dim ch-foot">
					Typing a goal pins it. Unpin a goal to let the character's own answers move it.
					Each character asked is one call.
				</p>
			{/if}
		</div>
	{/snippet}
</FloatingWindow>

<style>
	/* `flex: 1` puts the layer's hide control at the far right, as every panel's title does. */
	.ch-title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
	}

	.ch-body {
		padding: 0.75rem;
		overflow-y: auto;
		height: 100%;
		width: 100%;
		font-size: 0.85rem;
	}

	.ch-empty {
		color: var(--color-text-secondary);
		margin: 0;
	}

	.ch-dim {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.ch-gap {
		margin: 0 0 0.5rem;
	}

	.ch-switch {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: 0.55rem;
		margin-bottom: 0.6rem;
		cursor: pointer;
	}

	/* The scene switch is a setting OF the chat switch above it, so it sits indented under it
	   rather than as a peer. A div rather than a label: it holds its own number field, and a
	   label wrapping both would hand every click on the field to the toggle. */
	.ch-switch--sub {
		margin-left: 1.2rem;
		cursor: default;
	}

	.ch-numinput {
		width: 2.8rem;
		margin: 0 0.15rem;
		padding: 0 0.25rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}

	.ch-numinput:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.ch-answer-note {
		margin: 0;
		padding-left: 0.6rem;
		border-left: 2px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
	}

	.ch-switch-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.ch-name {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-primary);
	}

	.ch-status {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.75rem;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-border-subtle) 35%, transparent);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	.ch-status.is-failed {
		color: var(--color-warning);
	}

	.ch-pulse {
		flex-shrink: 0;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--color-accent);
		animation: ch-pulse 1.2s ease-in-out infinite;
	}

	@keyframes ch-pulse {
		50% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ch-pulse {
			animation: none;
		}
	}

	.ch-h {
		margin: 0 0 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 640;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.ch-members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ch-member {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		border-radius: var(--radius-md);
	}

	/* A muted member keeps its goals on screen, dimmed, rather than hiding them: switching it
	   back on should not feel like starting over. */
	.ch-member.is-off .ch-goals,
	.ch-member.is-off .ch-nameinput {
		opacity: 0.55;
	}

	.ch-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.ch-nameinput,
	.ch-goalinput,
	.ch-addinput {
		min-width: 0;
		flex: 1;
		padding: 0.2rem 0.35rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
	}

	.ch-nameinput {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.ch-goalinput {
		font-size: 0.74rem;
	}

	.ch-nameinput:hover,
	.ch-goalinput:hover {
		border-color: color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
	}

	.ch-nameinput:focus,
	.ch-goalinput:focus,
	.ch-addinput:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.ch-goalinput::placeholder,
	.ch-addinput::placeholder {
		color: var(--color-text-muted);
	}

	.ch-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.ch-icon:hover:not(:disabled) {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
	}

	.ch-icon:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.ch-icon.is-on {
		color: var(--color-accent);
	}

	.ch-icon--danger:hover:not(:disabled) {
		color: var(--color-error);
	}

	.ch-answer {
		margin: 0;
		padding-left: 0.6rem;
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 0.5rem;
		row-gap: 0.15rem;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.ch-answer dt {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
		padding-top: 0.1rem;
	}

	.ch-answer dd {
		margin: 0;
		color: var(--color-text-primary);
		font-family: var(--font-body);
	}

	.ch-answer--error {
		display: block;
		border-left-color: var(--color-warning);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-warning);
	}

	.ch-goals {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.ch-goal {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.ch-goal-label {
		flex-shrink: 0;
		width: 4.2rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	.ch-add {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.6rem;
	}

	.ch-addinput {
		font-size: 0.78rem;
		border-color: color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
	}

	.ch-addbtn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		cursor: pointer;
	}

	.ch-addbtn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.ch-addbtn:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.ch-foot {
		margin: 0.75rem 0 0;
	}
</style>
