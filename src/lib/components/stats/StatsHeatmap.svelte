<script lang="ts">
	/**
	 * Every week the reader has written, one square per day, weeks running left to right.
	 *
	 * The grid is the screenshot this whole screen exists for, so it answers to three rules.
	 * **It holds the whole history and opens at the present**: the panel is only ever a few
	 * hundred pixels wide, so the grid shows the most recent stretch that fits and scrolls
	 * back through everything older, rather than cutting the years before last off the record.
	 * **It never shows more calendar than the reader has lived**: it starts at the first week
	 * they wrote in, so a library three weeks old is three weeks wide instead of a year of
	 * grey with a corner of colour. And **the scale is relative to a busy day, not the busiest
	 * one**: one all-nighter of four hundred messages would otherwise flatten every ordinary
	 * day to the palest step and leave a reader looking at a blank year with a single bright
	 * square in it.
	 */
	import { dayLabel, plural } from '$lib/stats/format';
	import { startOfLocalDay, nextLocalDay, type ActiveDay } from '$lib/stats/derive';

	let { days, now }: { days: ActiveDay[]; now: number } = $props();

	/** Monday first, so a weekend reads as the pair of rows at the bottom. */
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	let scroller = $state<HTMLDivElement | null>(null);
	let byDay = $derived(new Map(days.map((d) => [d.at, d.count])));

	/** Monday of the week `at` falls in. */
	function startOfWeek(at: number): number {
		const date = new Date(at);
		const shift = (date.getDay() + 6) % 7;
		return new Date(date.getFullYear(), date.getMonth(), date.getDate() - shift).getTime();
	}

	let today = $derived(startOfLocalDay(now));
	let lastWeek = $derived(startOfWeek(today));
	let firstWeek = $derived(days.length ? startOfWeek(days[0].at) : lastWeek);

	/** Columns of seven days, oldest week first. A day past today is null: the week the
	 *  reader is standing in is drawn as the part of it that has happened. */
	let columns = $derived.by(() => {
		const out: { at: number; count: number | null }[][] = [];
		let cursor = firstWeek;
		while (cursor <= lastWeek) {
			const week: { at: number; count: number | null }[] = [];
			let day = cursor;
			for (let i = 0; i < 7; i++) {
				week.push({ at: day, count: day > today ? null : (byDay.get(day) ?? 0) });
				day = nextLocalDay(day);
			}
			out.push(week);
			cursor = day;
		}
		return out;
	});

	// Open on the present and re-anchor whenever the count is taken again: this week is the
	// part of the grid a reader came to look at, and the years behind it are the part they
	// go looking for.
	$effect(() => {
		void columns.length;
		if (scroller) scroller.scrollLeft = scroller.scrollWidth;
	});

	/**
	 * The count a full square means: the busiest day among the quieter nine tenths.
	 * Everything at or above it is the top step, so an exceptional night reads as
	 * exceptional without dragging the whole year down with it.
	 */
	let ceiling = $derived.by(() => {
		const counts = days.map((d) => d.count).sort((a, b) => a - b);
		if (!counts.length) return 1;
		return Math.max(1, counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.9))]);
	});

	function level(count: number | null): number {
		if (count === null || count === 0) return 0;
		return Math.min(4, Math.max(1, Math.ceil((count / ceiling) * 4)));
	}

	/**
	 * Years as spans over the weeks they hold, drawn as a rule above the months.
	 *
	 * The year cannot ride on the month labels: two of them land four weeks apart and a
	 * "Jul 2025" sits straight on top of the "Aug" beside it. A row of its own, ruled across
	 * the months it covers, says which year is on screen without crowding anything.
	 */
	let yearSpans = $derived.by(() => {
		const spans: { from: number; to: number; label: string }[] = [];
		columns.forEach((week, index) => {
			const label = `${new Date(week[0].at).getFullYear()}`;
			const open = spans[spans.length - 1];
			if (open && open.label === label) open.to = index;
			else spans.push({ from: index, to: index, label });
		});
		return spans;
	});

	/** Month names above the columns where a month starts. The year rides in the row above. */
	let monthMarks = $derived.by(() => {
		const marks: { index: number; label: string }[] = [];
		let previous = -1;
		columns.forEach((week, index) => {
			const date = new Date(week[0].at);
			if (date.getMonth() === previous) return;
			marks.push({ index, label: date.toLocaleDateString(undefined, { month: 'short' }) });
			previous = date.getMonth();
		});
		// The first mark is dropped when its month barely shows, or a three-letter label
		// hangs off the left edge over a single column.
		return marks[1]?.index === 1 ? marks.slice(1) : marks;
	});

	function title(at: number, count: number | null): string {
		const key = new Date(at);
		const label = dayLabel(
			`${key.getFullYear()}-${`${key.getMonth() + 1}`.padStart(2, '0')}-${`${key.getDate()}`.padStart(2, '0')}`
		);
		if (count === null) return label;
		return count ? `${plural(count, 'message')} on ${label}` : `Nothing on ${label}`;
	}
</script>

<div class="heatmap">
	<!-- The day names sit OUTSIDE the scroller: the grid opens at the present, so a gutter
	     inside it would start scrolled off the left edge and never be seen. -->
	<div class="plot">
		<div class="weekdays" aria-hidden="true">
			{#each WEEKDAYS as day (day)}
				<span class="weekday">{day}</span>
			{/each}
		</div>

		<div class="scroller" bind:this={scroller}>
			<div class="grid-shell" style="--columns: {columns.length}">
				<div class="years">
					{#each yearSpans as year (year.from)}
						<span class="year" style="grid-column: {year.from + 1} / {year.to + 2}"
							>{year.to > year.from ? year.label : ''}</span
						>
					{/each}
				</div>

				<div class="months">
					{#each monthMarks as mark (mark.index)}
						<span class="month" style="grid-column: {mark.index + 1}">{mark.label}</span>
					{/each}
				</div>

				<div class="weeks">
					{#each columns as week, w (w)}
						<div class="week">
							{#each week as cell (cell.at)}
								<div
									class="cell"
									class:is-void={cell.count === null}
									class:is-today={cell.at === today}
									data-level={level(cell.count)}
									title={title(cell.at, cell.count)}
								></div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<div class="legend">
		<span>Quieter</span>
		{#each [0, 1, 2, 3, 4] as step (step)}
			<div class="cell legend-cell" data-level={step}></div>
		{/each}
		<span>Busier</span>
	</div>
</div>

<style>
	.heatmap {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	/* Bottom-aligned, so the seven day names line up with the seven cell rows without either
	   side hardcoding the height of the month strip above the grid. */
	.plot {
		display: flex;
		align-items: flex-end;
		gap: 0.35rem;
	}

	.weekdays {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		gap: 0.15rem;
		width: 1.75rem;
		/* Matches the scroller's own bottom padding, or the labels sit a scrollbar too low. */
		padding-bottom: 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.6rem;
		color: var(--color-text-muted);
	}

	/* Every day is named, so each label stands exactly as tall as the row it names. */
	.weekday {
		height: 0.9rem;
		line-height: 0.9rem;
	}

	/* The grid is wider than a phone and must never widen the panel itself. */
	.scroller {
		min-width: 0;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding-bottom: 0.2rem;
	}

	.grid-shell {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: max-content;
	}

	/* One column per week, so a column is the grid's own pitch: a cell plus a gap. Both
	   header rows and the grid itself share it, or a label drifts off the month it names. */
	.years,
	.months {
		display: grid;
		grid-template-columns: repeat(var(--columns), 1.05rem);
		font-family: var(--font-ui);
		font-size: 0.62rem;
		line-height: 1;
		color: var(--color-text-muted);
	}

	/* The rule is what ties a year to the months under it. The gap on the right is what
	   keeps two years' rules from reading as one long line. */
	.year {
		overflow: hidden;
		margin-right: 0.2rem;
		padding-bottom: 0.2rem;
		border-bottom: 1px solid var(--theme-border-raised, var(--color-border-subtle));
		white-space: nowrap;
	}

	.month {
		white-space: nowrap;
	}

	.weeks {
		display: flex;
		gap: 0.15rem;
	}

	.week {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.cell {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 2px;
		background: var(--color-bg-tertiary);
	}

	/* One accent, four strengths. Mixing toward the accent rather than fading its alpha
	   keeps every step legible on a translucent panel over a photograph. */
	.cell[data-level='1'] {
		background: color-mix(in oklab, var(--color-accent) 28%, var(--color-bg-tertiary));
	}

	.cell[data-level='2'] {
		background: color-mix(in oklab, var(--color-accent) 52%, var(--color-bg-tertiary));
	}

	.cell[data-level='3'] {
		background: color-mix(in oklab, var(--color-accent) 76%, var(--color-bg-tertiary));
	}

	.cell[data-level='4'] {
		background: var(--color-accent);
	}

	/* Days that have not happened yet: present so the week keeps its shape, invisible so
	   they cannot be read as quiet ones. */
	.cell.is-void {
		background: transparent;
	}

	/* Today, ringed: the grid opens at the present, and this is the square that claim is
	   anchored to. */
	.cell.is-today {
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 70%, transparent);
	}

	/* Lined up under the grid, which starts past the day-name gutter and its gap. */
	.legend {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-left: 2.1rem;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		color: var(--color-text-muted);
	}

	.legend-cell {
		width: 0.6rem;
		height: 0.6rem;
	}

	.legend span:first-child {
		margin-right: 0.15rem;
	}

	.legend span:last-child {
		margin-left: 0.15rem;
	}
</style>
