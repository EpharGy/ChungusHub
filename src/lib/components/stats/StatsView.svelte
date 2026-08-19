<script lang="ts">
	/**
	 * The stats screen: what the reader has written, read in one pass.
	 *
	 * Two claims run through every figure here and the copy states both rather than leaving
	 * a reader to guess. **A chat is a tree**, so "how many" has two answers: everything
	 * written (rerolls included, because you asked for them and paid for them) and the story
	 * as it reads (the branch each chat is open at). **Nothing is estimated**: a figure the
	 * app never measured is absent, and every measured average carries the number of turns
	 * it covers, which matters most for imported chats, where token counts do not exist at
	 * all (architecture/sillytavern-interchange.md).
	 *
	 * The order is deliberate and is the order a reader cares in: the one big number, then
	 * the year, then the people, then the habit, then the shape, then the receipts. Nothing
	 * above the heatmap changes height with the data, so the picture people screenshot sits
	 * in the same place on every library. The whole body reads down one measured column:
	 * the overlay is as wide as the chat, and figures stretched across a reading measure
	 * stop lining up with their labels.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import StatsHeatmap from './StatsHeatmap.svelte';
	import StatsClock from './StatsClock.svelte';
	import StatsCast from './StatsCast.svelte';
	import StatsPosterDialog from './StatsPosterDialog.svelte';
	import { statsStore } from '$lib/stores/stats.svelte';
	import {
		count,
		plural,
		span,
		average,
		share,
		hourLabel,
		dayLabel,
		dateLabel,
		momentLabel,
		bookComparison,
		comparisonLabel
	} from '$lib/stats/format';

	// The panel is the only door to the aggregate, and it pays for the pass once per open.
	$effect(() => {
		void statsStore.load();
	});

	let snapshot = $derived(statsStore.snapshot);
	let posterOpen = $state(false);

	let comparison = $derived(snapshot ? bookComparison(snapshot.stats.effort.words) : null);

	/** Every character the aggregate counted, whether or not the library still holds them. */
	let castTotal = $derived(snapshot?.stats.cast.length ?? 0);

	/** The hour the most messages landed in, for the habit facts. Null on an empty library. */
	let peakHour = $derived.by(() => {
		if (!snapshot || !snapshot.hours.some((h) => h > 0)) return null;
		return snapshot.hours.indexOf(Math.max(...snapshot.hours));
	});

	let generationAverage = $derived.by(() => {
		if (!snapshot) return null;
		const { generationMs, generationTurns } = snapshot.stats.measured;
		return average(generationMs, generationTurns);
	});

	let firstTokenAverage = $derived.by(() => {
		if (!snapshot) return null;
		const { firstTokenMs, firstTokenTurns } = snapshot.stats.measured;
		return average(firstTokenMs, firstTokenTurns);
	});

	let promptTokenAverage = $derived.by(() => {
		if (!snapshot) return null;
		const { promptTokens, promptTokenTurns } = snapshot.stats.measured;
		const value = average(promptTokens, promptTokenTurns);
		return value === null ? null : Math.round(value);
	});

	let completionTokenAverage = $derived.by(() => {
		if (!snapshot) return null;
		const { completionTokens, completionTokenTurns } = snapshot.stats.measured;
		const value = average(completionTokens, completionTokenTurns);
		return value === null ? null : Math.round(value);
	});

	let measuredShare = $derived.by(() => {
		if (!snapshot) return null;
		const { generationTurns, assistantTurns } = snapshot.stats.measured;
		return share(generationTurns, assistantTurns);
	});
</script>

<div class="stats-panel">
	<header class="overlay-header">
		<div class="overlay-crumb">
			<h2 class="overlay-subject">Your Writing So Far</h2>
			<span class="overlay-facts">
				{#if snapshot}
					Counted {momentLabel(snapshot.takenAt)}
				{:else if statsStore.loading}
					Reading every message…
				{:else}
					Everything you have written here
				{/if}
			</span>
		</div>

		<div class="overlay-actions">
			<button
				type="button"
				class="overlay-action-btn overlay-action-btn--labeled"
				onclick={() => (posterOpen = true)}
				disabled={!snapshot || snapshot.stats.effort.messages === 0}
			>
				<Icon name="image" class="w-4 h-4" strokeWidth={2} />
				<span>Make a picture</span>
			</button>
			<button
				type="button"
				class="overlay-action-btn"
				onclick={() => void statsStore.refresh()}
				disabled={statsStore.loading}
				title="Count again"
				aria-label="Count again"
			>
				<Icon name="refresh" class="w-4 h-4" strokeWidth={2} />
			</button>
		</div>
	</header>

	<div class="body panel-scroll">
		{#if statsStore.error}
			<Alert message="Could not count your library. {statsStore.error}" />
		{:else if !snapshot}
			<div class="waiting"><Spinner /></div>
		{:else if snapshot.stats.effort.messages === 0}
			<EmptyState icon="chart" title="Nothing to count yet">
				Start a chat and this fills up on its own: every word, every night you wrote, everyone
				you wrote with.
			</EmptyState>
		{:else}
			{@const stats = snapshot.stats}

			<div class="measure">
				<!-- The one number, and the sentence that makes it mean something. -->
				<section class="hero">
					<div class="hero-figure">{count(stats.effort.words)}</div>
					<div class="hero-unit">words written</div>
					{#if comparison}
						<p class="hero-note">About as long as {comparisonLabel(comparison)}.</p>
					{/if}
				</section>

				<div class="tiles">
					<div class="tile">
						<span class="tile-figure">{count(stats.effort.messages)}</span>
						<span class="tile-label">turns</span>
						<span class="tile-note">{count(stats.story.messages)} of them on the branch you are reading</span>
					</div>
					<div class="tile">
						<span class="tile-figure">{count(stats.library.chats)}</span>
						<span class="tile-label">{stats.library.chats === 1 ? 'chat' : 'chats'}</span>
						<span class="tile-note">with {plural(stats.library.characters, 'character')}</span>
					</div>
					<div class="tile">
						<span class="tile-figure">{count(snapshot.days.length)}</span>
						<span class="tile-label">days written on</span>
						<span class="tile-note">
							{#if snapshot.current.days > 0}
								{plural(snapshot.current.days, 'day')} running right now
							{:else}
								Longest run: {plural(snapshot.longest.days, 'day')}
							{/if}
						</span>
					</div>
					<div class="tile">
						<span class="tile-figure">{count(stats.effort.userWords)}</span>
						<span class="tile-label">words of your own</span>
						<span class="tile-note">
							{#if share(stats.effort.userWords, stats.effort.words) !== null}
								{share(stats.effort.userWords, stats.effort.words)}% of the page is you
							{/if}
						</span>
					</div>
				</div>

				<section class="block">
					<h3 class="block-title">Day by day</h3>
					<StatsHeatmap days={snapshot.days} now={snapshot.takenAt} />
					<div class="facts">
						{#if snapshot.busiest}
							<div class="fact">
								<span class="fact-value">{plural(snapshot.busiest.count, 'message')}</span>
								<span class="fact-label">busiest day · {dayLabel(snapshot.busiest.key)}</span>
							</div>
						{/if}
						{#if snapshot.longest.days > 0 && snapshot.longest.from}
							<div class="fact">
								<span class="fact-value">{plural(snapshot.longest.days, 'day')}</span>
								<span class="fact-label">
									longest run · {snapshot.longest.days > 1
										? `started ${dayLabel(snapshot.longest.from)}`
										: dayLabel(snapshot.longest.from)}
								</span>
							</div>
						{/if}
						{#if snapshot.current.days > 0 && snapshot.current.from}
							<div class="fact">
								<span class="fact-value">{plural(snapshot.current.days, 'day')}</span>
								<span class="fact-label">running right now · since {dayLabel(snapshot.current.from)}</span>
							</div>
						{:else if stats.records.lastMessageAt}
							<div class="fact">
								<span class="fact-value">{dateLabel(stats.records.lastMessageAt)}</span>
								<span class="fact-label">last wrote</span>
							</div>
						{/if}
					</div>
				</section>

				{#if castTotal > 0}
					<section class="block">
						<h3 class="block-title">Your cast</h3>
						<StatsCast cast={stats.cast} />
						{#if castTotal > 6}
							<p class="block-note">Showing the six you have written most with, of {count(castTotal)}.</p>
						{/if}
					</section>
				{/if}

				<section class="block">
					<h3 class="block-title">When you write</h3>
					<StatsClock hours={snapshot.hours} prime={snapshot.prime} />
					<div class="facts">
						{#if snapshot.prime}
							<div class="fact">
								<span class="fact-value">
									{hourLabel(snapshot.prime[0])} to {hourLabel((snapshot.prime[1] + 1) % 24)}
								</span>
								<span class="fact-label">half of everything lands here</span>
							</div>
						{/if}
						{#if peakHour !== null}
							<div class="fact">
								<span class="fact-value">{hourLabel(peakHour)} to {hourLabel((peakHour + 1) % 24)}</span>
								<span class="fact-label">your single busiest hour</span>
							</div>
						{/if}
					</div>
				</section>

				<section class="block">
					<h3 class="block-title">The shape of it</h3>
					<div class="rows">
						<div class="row">
							<span class="row-label"
								>Turns you left behind <InfoTip
									text="Rerolls you swiped past, forks you left, greetings you did not pick, and everything written below them."
								/></span
							>
							<span class="row-value">{count(stats.shape.abandoned)}</span>
						</div>
						<div class="row">
							<span class="row-label"
								>Longest single chat <InfoTip
									text="The most turns one chat holds along the branch it is open at."
								/></span
							>
							<span class="row-value">{plural(stats.shape.longestStory, 'turn')}</span>
						</div>
						{#if stats.library.memoryEpisodes > 0}
							<div class="row">
								<span class="row-label"
									>Scenes your chats remember <InfoTip
										text="Summaries chat memory has written, so a scene can still reach the model long after it scrolled out of the prompt."
									/></span
								>
								<span class="row-value">{count(stats.library.memoryEpisodes)}</span>
							</div>
						{/if}
						{#if stats.library.lorebookEntries > 0}
							<div class="row">
								<span class="row-label"
									>Lorebook entries in your library <InfoTip
										text="Every entry across every lorebook you hold, whether you wrote it here or brought it in."
									/></span
								>
								<span class="row-value">
									{count(stats.library.lorebookEntries)}<span class="row-sub"
										>across {plural(stats.library.lorebooks, 'book')}</span
									>
								</span>
							</div>
						{/if}
					</div>
				</section>

				<section class="block">
					<h3 class="block-title">Records</h3>
					<div class="rows">
						{#if stats.records.longestReply}
							<div class="row">
								<span class="row-label"
									>Longest reply you were sent <InfoTip
										text="The most words a model put in one turn, anywhere in your library."
									/></span
								>
								<span class="row-value">{plural(stats.records.longestReply.words, 'word')}</span>
							</div>
						{/if}
						{#if stats.records.longestUserTurn}
							<div class="row">
								<span class="row-label"
									>Longest thing you wrote in one go <InfoTip
										text="The most words you put in one turn before sending it."
									/></span
								>
								<span class="row-value">{plural(stats.records.longestUserTurn.words, 'word')}</span>
							</div>
						{/if}
						{#if stats.records.firstMessageAt}
							<div class="row">
								<span class="row-label"
									>First words here <InfoTip
										text="The date on the oldest turn you hold. An imported chat keeps the day it was written, not the day it arrived."
									/></span
								>
								<span class="row-value">{dateLabel(stats.records.firstMessageAt)}</span>
							</div>
						{/if}
					</div>
				</section>

				<!-- Deliberately last, and deliberately fenced: these cover only the turns that
				     recorded a number, which on an imported library is a fraction of it. -->
				<section class="block">
					<h3 class="block-title">What it cost</h3>
					{#if stats.measured.generationTurns === 0 && stats.measured.promptTokenTurns === 0}
						<p class="block-note">
							Nothing here recorded what it cost. Turns generated in ChungusHub from now on will.
						</p>
					{:else}
						<div class="rows">
							{#if generationAverage !== null}
								<div class="row">
									<span class="row-label"
										>Time spent waiting for replies <InfoTip
											text="Every reply's generation added up, each one timed from the moment it was asked for to its last word."
										/></span
									>
									<span class="row-value">
										{span(stats.measured.generationMs)} in total<span class="row-sub"
											>{span(generationAverage)} on average, over {plural(
												stats.measured.generationTurns,
												'measured turn'
											)}</span
										>
									</span>
								</div>
							{/if}
							{#if firstTokenAverage !== null}
								<div class="row">
									<span class="row-label"
										>Wait before the first word appears <InfoTip
											text="How long a reply takes to start arriving. It is the opening slice of the wait above, not an extra one."
										/></span
									>
									<span class="row-value">
										{span(firstTokenAverage)} on average<span class="row-sub"
											>over {plural(stats.measured.firstTokenTurns, 'measured turn')}</span
										>
									</span>
								</div>
							{/if}
							{#if stats.measured.reasoningTurns > 0}
								<div class="row">
									<span class="row-label"
										>Time models spent thinking <InfoTip
											text="Reasoning time, on the models that think before they answer. It is part of the wait, not on top of it."
										/></span
									>
									<span class="row-value">
										{span(stats.measured.reasoningMs)} in total<span class="row-sub"
											>over {plural(stats.measured.reasoningTurns, 'reasoning turn')}</span
										>
									</span>
								</div>
							{/if}
							{#if stats.measured.promptTokenTurns > 0}
								<div class="row">
									<span class="row-label"
										>Tokens sent <InfoTip
											text="What each request carried: the whole assembled prompt, not just the words you typed."
										/></span
									>
									<span class="row-value">
										{count(stats.measured.promptTokens)}<span class="row-sub"
											>{#if promptTokenAverage !== null}{count(promptTokenAverage)} per request on
												average, {/if}over {plural(stats.measured.promptTokenTurns, 'measured turn')}</span
										>
									</span>
								</div>
							{/if}
							{#if stats.measured.completionTokenTurns > 0}
								<div class="row">
									<span class="row-label"
										>Tokens written back <InfoTip
											text="What came back, counted by the provider that generated it rather than by this app."
										/></span
									>
									<span class="row-value">
										{count(stats.measured.completionTokens)}<span class="row-sub"
											>{#if completionTokenAverage !== null}{count(completionTokenAverage)} per reply on
												average, {/if}over {plural(stats.measured.completionTokenTurns, 'measured turn')}</span
										>
									</span>
								</div>
							{/if}
						</div>
						{#if measuredShare !== null && measuredShare < 100}
							<p class="block-note">
								These figures only include replies with a recorded timing ({measuredShare}% of the
								total). Opening greetings and imported messages without time data are excluded
								rather than estimated.
							</p>
						{/if}
					{/if}
				</section>
			</div>
		{/if}
	</div>
</div>

<!-- Mounted unconditionally: the dialog portals to body and owns its own open state, so
     gating it on the data here would be exactly the lifetime binding that leaves a portaled
     node detached for good (architecture/ui-shell-settings.md). -->
<StatsPosterDialog bind:open={posterOpen} {snapshot} />

<style>
	.stats-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: transparent;
	}

	.body {
		flex: 1;
		min-height: 0;
		overscroll-behavior: contain;
		padding: 1.1rem 0.9rem 2rem;
	}

	/* One measured column, centered: the overlay is as wide as the chat, and a stat row
	   stretched across a reading measure separates its figure from its label. */
	.measure {
		max-width: 46rem;
		margin-inline: auto;
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
	}

	/* Sections rise in as the count lands: one soft pass, nothing that loops. The global
	   reduced-motion override flattens it. */
	.measure > * {
		animation: stats-rise 360ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}

	.measure > *:nth-child(2) {
		animation-delay: 40ms;
	}

	.measure > *:nth-child(3) {
		animation-delay: 80ms;
	}

	.measure > *:nth-child(4) {
		animation-delay: 120ms;
	}

	.measure > *:nth-child(n + 5) {
		animation-delay: 160ms;
	}

	@keyframes stats-rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.waiting {
		display: flex;
		justify-content: center;
		padding: 3rem 0;
	}

	.hero {
		text-align: center;
		padding: 0.5rem 0 0.2rem;
	}

	/* The one figure on the screen set in the story face: the number is the book the
	   reader wrote, so it wears the type their story does. */
	.hero-figure {
		font-family: var(--font-body);
		font-size: clamp(2.8rem, 9vw, 4.4rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}

	.hero-unit {
		margin-top: 0.45rem;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.hero-note {
		margin: 0.7rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.6rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--theme-border-raised, var(--color-border-subtle));
		border-radius: var(--radius-lg);
		background: var(--color-bg-secondary);
	}

	.tile-figure {
		font-family: var(--font-ui);
		font-size: 1.5rem;
		font-weight: 650;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}

	.tile-label {
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.tile-note {
		margin-top: 0.25rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	/* The title carries a hairline out to the right edge, so each section starts on a
	   rule the eye can find while scrolling. */
	.block-title {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.block-title::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--theme-border-raised, var(--color-border-subtle));
	}

	.block-note {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	/* The figures a chart leaves behind, each naming itself: a value and the sentence
	   under it, instead of prose the eye has to parse for the number. */
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.6rem;
	}

	.fact {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.55rem 0.7rem;
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
	}

	.fact-value {
		font-family: var(--font-ui);
		font-size: 0.92rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}

	.fact-label {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.rows {
		display: flex;
		flex-direction: column;
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--theme-border-raised, var(--color-border-subtle));
	}

	.row:last-child {
		border-bottom: none;
	}

	.row-label {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

	.row-value {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text-primary);
	}

	.row-sub {
		font-weight: 400;
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}
</style>
