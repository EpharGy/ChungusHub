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
	 */
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { toggleRow } from '$lib/actions/toggleRow';
	import { echoChamberStore } from '$lib/stores/echochamber.svelte';
	import { BOUNDS } from '$lib/echochamber/config';

	const settings = $derived(echoChamberStore.settings);
	const style = $derived(echoChamberStore.activeStyle);
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
				text="The style is the crowd's personality: who they are, how they write, and what they care about. It is the whole character of the feed, so it is worth trying a few."
			/>
		</div>

		<div class="card-body">
			<div class="field">
				<span class="field-label">Chat style</span>
				<Select
					value={settings.styleId}
					onchange={(e) => echoChamberStore.update({ styleId: e.currentTarget.value })}
				>
					{#each echoChamberStore.styles as option (option.id)}
						<option value={option.id}>{option.name}</option>
					{/each}
				</Select>
			</div>

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

			<details class="preview">
				<summary>Show this style's prompt</summary>
				<pre class="preview-text">{style.prompt}</pre>
			</details>
		</div>
	</section>

	<section class="card" data-setting="echochamber-crowd">
		<div class="card-head">
			<span class="card-title">The crowd</span>
		</div>

		<div class="card-body">
			<div class="grid">
				<div class="field">
					<span class="field-label">Reactions per reply</span>
					<input
						class="input"
						type="number"
						min={BOUNDS.reactionCount.min}
						max={BOUNDS.reactionCount.max}
						value={settings.reactionCount}
						onchange={(e) =>
							echoChamberStore.update({ reactionCount: Number(e.currentTarget.value) })}
					/>
				</div>

				<div class="field">
					<span class="field-label">Newest reaction</span>
					<Select
						value={settings.messageOrder}
						onchange={(e) =>
							echoChamberStore.update({
								messageOrder: e.currentTarget.value === 'newest-first'
									? 'newest-first'
									: 'oldest-first'
							})}
					>
						<option value="oldest-first">At the bottom</option>
						<option value="newest-first">At the top</option>
					</Select>
				</div>
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
				<div class="field pair-inset">
					<span class="field-label">Turns of history to send</span>
					<input
						class="input"
						type="number"
						min={BOUNDS.contextDepth.min}
						max={BOUNDS.contextDepth.max}
						value={settings.contextDepth}
						onchange={(e) =>
							echoChamberStore.update({ contextDepth: Number(e.currentTarget.value) })}
					/>
				</div>
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

	/* Indented under the switch that reveals it, so it reads as that switch's detail
	   rather than as another row in the card. */
	.pair-inset {
		margin-left: 0.5rem;
		max-width: 14rem;
	}

	.preview > summary {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	/* The prompt is long and pre-wrapped: readable, scrollable, and clearly not a field
	   anyone is meant to type into here. */
	.preview-text {
		margin: 0.4rem 0 0;
		max-height: 16rem;
		overflow: auto;
		padding: 0.6rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.4rem;
		background: var(--color-bg-primary);
		font-size: 0.72rem;
		line-height: 1.5;
		white-space: pre-wrap;
		color: var(--color-text-secondary);
	}
</style>
