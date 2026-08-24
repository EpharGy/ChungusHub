<script lang="ts">
	/**
	 * Settings → App → EchoChamber: who the crowd is, how many of them there are, and how
	 * much of the story they get to see.
	 *
	 * Ordered by how often a reader touches it: the switch and the style at the top (the
	 * style is the whole feature, and swapping it is the thing anyone does most), the crowd's
	 * size next, and what reaches the model last.
	 *
	 * It has its own page rather than a section on Engines because its prompts are a LIST a
	 * reader adds to, not a fixed set of templates, and the Engines page's inline editor is
	 * built for the latter. The engine's on/off switch appears in both places on purpose:
	 * both read the same setting, so neither can drift from the other.
	 *
	 * The editor is upstream's Advanced mode and nothing more: a name and a raw prompt. That
	 * is not a cut-down version of it, it is the whole of it, and it is what makes a style
	 * portable - upstream exports a plain .md of the prompt text, so a style moves between
	 * the two by copy and paste with no conversion.
	 */
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { toggleRow } from '$lib/actions/toggleRow';
	import { echoChamberStore } from '$lib/stores/echochamber.svelte';
	import { BOUNDS } from '$lib/echochamber/config';
	import { MAX_CUSTOM_STYLES } from '$lib/echochamber/custom-styles';

	const settings = $derived(echoChamberStore.settings);
	const style = $derived(echoChamberStore.activeStyle);
	const builtIns = $derived(echoChamberStore.styles.filter((s) => !s.custom));
	const mine = $derived(echoChamberStore.styles.filter((s) => s.custom));

	// The editor holds a draft rather than writing through on every keystroke: a prompt is
	// hundreds of characters typed one at a time, and every write here is a settings
	// broadcast every other device re-reads.
	let draftFor = $state<string | null>(null);
	let draftName = $state('');
	let draftPrompt = $state('');

	// Re-seed the draft whenever the selected style changes. Keyed on the id rather than on
	// the object so saving (which replaces the object) does not wipe the field being typed in.
	$effect(() => {
		if (draftFor !== style.id) {
			draftFor = style.id;
			draftName = style.name;
			draftPrompt = style.prompt;
		}
	});

	const dirty = $derived(
		style.custom && (draftName !== style.name || draftPrompt !== style.prompt)
	);
	const atLimit = $derived(mine.length >= MAX_CUSTOM_STYLES);

	function save() {
		if (!style.custom || !draftName.trim() || !draftPrompt.trim()) return;
		echoChamberStore.saveStyle({ ...style, name: draftName.trim(), prompt: draftPrompt });
	}

	function revert() {
		draftName = style.name;
		draftPrompt = style.prompt;
	}

	/** Copy the selected style into a new editable one and switch to it. */
	function duplicate() {
		const created = echoChamberStore.createStyle(style);
		echoChamberStore.update({ styleId: created.id });
	}

	function remove() {
		echoChamberStore.deleteStyle(style.id);
	}
</script>

<div class="echo-page">
	<section class="card" data-setting="echochamber-engine">
		<div class="card-head">
			<span class="card-title">EchoChamber</span>
			<InfoTip
				text="After each reply, the engine writes a feed of audience reactions to it: a Discord room, a news ticker, a comment section. The feed opens from its own floating button and can sit anywhere on screen while you read."
			/>
		</div>

		<div class="card-body">
			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Generate audience reactions</span>
				<Toggle
					checked={settings.enabled}
					onchange={(v) => echoChamberStore.update({ enabled: v })}
					label="Generate audience reactions"
				/>
			</div>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Start as soon as a reply lands</span>
				<Toggle
					checked={settings.autoGenerate}
					onchange={(v) => echoChamberStore.update({ autoGenerate: v })}
					label="Start as soon as a reply lands"
				/>
			</div>
			<p class="hint">
				Off leaves the feed to its own refresh button, which is the cheaper way to read
				back a long chat: every reaction is a model call on the EchoChamber connection.
			</p>
		</div>
	</section>

	<section class="card" data-setting="echochamber-style">
		<div class="card-head">
			<span class="card-title">Style</span>
			<InfoTip
				text="The style is the crowd's personality: who they are, how they write, and what they care about. It is the whole character of the feed, so it is worth trying a few. Your own styles are plain text and nothing else, so one written for the SillyTavern extension pastes straight in."
			/>
		</div>

		<div class="card-body">
			<label class="field">
				<span class="field-label">Chat style</span>
				<Select
					value={settings.styleId}
					onchange={(e) => echoChamberStore.update({ styleId: e.currentTarget.value })}
				>
					<optgroup label="Built in">
						{#each builtIns as option (option.id)}
							<option value={option.id}>{option.name}</option>
						{/each}
					</optgroup>
					{#if mine.length}
						<optgroup label="Yours">
							{#each mine as option (option.id)}
								<option value={option.id}>{option.name}</option>
							{/each}
						</optgroup>
					{/if}
				</Select>
			</label>

			{#if style.usesStoryCast}
				<p class="hint">
					This style is voiced by your own characters rather than by invented handles. With
					only one character bound it lets the model name whoever is speaking in the
					narrative, since a single card usually names the story rather than a person.
				</p>
			{:else if style.narrator}
				<p class="hint">
					This style is one voice rather than a crowd, so the count below is how many
					messages that single narrator writes.
				</p>
			{/if}

			{#if style.custom}
				<label class="field">
					<span class="field-label">Name</span>
					<input class="input-base" type="text" maxlength="60" bind:value={draftName} />
				</label>
			{/if}

			<label class="field">
				<span class="field-label">
					{style.custom ? 'Prompt' : 'Prompt (built in, read only)'}
				</span>
				<textarea
					class="input-base prompt-area"
					rows="14"
					readonly={!style.custom}
					bind:value={draftPrompt}
				></textarea>
			</label>

			<p class="hint">
				Macros: <code>{'{{user}}'}</code> and <code>{'{{char}}'}</code> resolve like they do
				anywhere else, <code>{'{{characters}}'}</code> becomes your cast as a list. End the prompt
				by telling the model to answer as <code>username: message</code> lines, one per line,
				or nothing can be read back out of the reply.
			</p>

			<div class="row">
				{#if style.custom}
					<Button variant="primary" size="sm" onclick={save} disabled={!dirty}>
						{dirty ? 'Save changes' : 'Saved'}
					</Button>
					<Button variant="secondary" size="sm" onclick={revert} disabled={!dirty}>
						Revert
					</Button>
					<Button variant="secondary" size="sm" onclick={duplicate} disabled={atLimit}>
						Duplicate
					</Button>
					<Button variant="danger" size="sm" onclick={remove}>Delete</Button>
				{:else}
					<Button variant="secondary" size="sm" onclick={duplicate} disabled={atLimit}>
						Duplicate to edit
					</Button>
					<span class="hint">
						A shipped style is never edited in place, so an update to it can still reach
						you. Duplicating gives you a copy that is yours.
					</span>
				{/if}
			</div>

			{#if atLimit}
				<p class="hint">
					You have {MAX_CUSTOM_STYLES} styles, which is the limit. Delete one to add another.
				</p>
			{/if}
		</div>
	</section>

	<section class="card" data-setting="echochamber-crowd">
		<div class="card-head">
			<span class="card-title">The crowd</span>
		</div>

		<div class="card-body">
			<div class="grid">
				<label class="field">
					<span class="field-label">Reactions per reply</span>
					<input
						class="input-base"
						type="number"
						min={BOUNDS.reactionCount.min}
						max={BOUNDS.reactionCount.max}
						value={settings.reactionCount}
						onchange={(e) =>
							echoChamberStore.update({ reactionCount: Number(e.currentTarget.value) })}
					/>
				</label>

				<label class="field">
					<span class="field-label">Newest reaction</span>
					<Select
						value={settings.messageOrder}
						onchange={(e) =>
							echoChamberStore.update({
								messageOrder:
									e.currentTarget.value === 'newest-first' ? 'newest-first' : 'oldest-first'
							})}
					>
						<option value="oldest-first">At the bottom</option>
						<option value="newest-first">At the top</option>
					</Select>
				</label>
			</div>
			<p class="hint">
				Each reaction is its own line of generated prose, so the count is what the feed
				costs on every reply.
			</p>
		</div>
	</section>

	<section class="card" data-setting="echochamber-context">
		<div class="card-head">
			<span class="card-title">What the crowd sees</span>
			<InfoTip
				text="Everything here is sent with the reply being reacted to. More context makes the reactions land better and costs more per turn."
			/>
		</div>

		<div class="card-body">
			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Your messages too, not just the reply</span>
				<Toggle
					checked={settings.includeUserInput}
					onchange={(v) => echoChamberStore.update({ includeUserInput: v })}
					label="Your messages too, not just the reply"
				/>
			</div>

			{#if settings.includeUserInput}
				<label class="field pair-inset">
					<span class="field-label">Turns of history to send</span>
					<input
						class="input-base"
						type="number"
						min={BOUNDS.contextDepth.min}
						max={BOUNDS.contextDepth.max}
						value={settings.contextDepth}
						onchange={(e) =>
							echoChamberStore.update({ contextDepth: Number(e.currentTarget.value) })}
					/>
				</label>
			{/if}

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Your persona's description</span>
				<Toggle
					checked={settings.includePersona}
					onchange={(v) => echoChamberStore.update({ includePersona: v })}
					label="Your persona's description"
				/>
			</div>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">The character's description</span>
				<Toggle
					checked={settings.includeCharacterDescription}
					onchange={(v) => echoChamberStore.update({ includeCharacterDescription: v })}
					label="The character's description"
				/>
			</div>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">What the crowd said last time</span>
				<Toggle
					checked={settings.includePastReactions}
					onchange={(v) => echoChamberStore.update({ includePastReactions: v })}
					label="What the crowd said last time"
				/>
			</div>
			<p class="hint">
				Past reactions let a running joke or an argument between two regulars carry across
				turns. Only the last few feeds are kept, so it fades on its own further back.
			</p>
		</div>
	</section>
</div>

<style>
	.echo-page {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.field-label {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.7rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	/* Indented under the switch that reveals it, so it reads as that switch's detail
	   rather than as another row in the card. */
	.pair-inset {
		margin-left: 0.5rem;
		max-width: 14rem;
	}

	/* A style is a long instruction, so the field is sized to read one rather than to
	   peek at it, and monospaced because its last lines are an output contract. */
	.prompt-area {
		font-family: var(--font-mono);
		font-size: 0.74rem;
		line-height: 1.5;
		resize: vertical;
		white-space: pre-wrap;
	}

	.prompt-area[readonly] {
		opacity: 0.75;
		cursor: default;
	}
</style>
