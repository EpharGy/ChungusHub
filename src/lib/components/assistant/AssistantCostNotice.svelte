<script lang="ts">
	/**
	 * The assistant's one-time cost notice: a full-height view inside the assistant panel,
	 * the AssistantSettingsView shape and for the same reason, that this belongs to the
	 * assistant and not over the app. It takes the whole panel so there is nothing beside it
	 * to read instead, which is the only way a notice that costs money gets read at all.
	 *
	 * It states the mechanic the panel's shape hides (one message, many requests, each of them
	 * carrying the whole conversation and the tool block), then asks for the one precaution
	 * that actually holds: a spending limit on the key. The last line is an aside for readers
	 * who already know the shape from agentic coding tools, and it is set quieter because it
	 * lets exactly those readers stop reading. No figure is quoted anywhere: what a turn costs
	 * is the model's price against the job's size, so any number here would be wrong for
	 * everyone.
	 *
	 * **Only the button marks it read.** It comes back on every open until Got it is pressed,
	 * since an appearance is not a reading and a panel somebody minimized again taught them
	 * nothing.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { generalSettingsStore } from '$lib/stores/general-settings.svelte';
</script>

<section class="cost" aria-label="What the assistant costs">
	<div class="cost-body panel-scroll">
		<span class="cost-icon"><Icon name="coin" class="w-7 h-7" strokeWidth={1.5} /></span>
		<h2 class="cost-title">Before you use this</h2>
		<p class="cost-text">
			A single message can produce many model requests, each carrying the whole conversation
			and every tool definition. Set a spending limit on the key behind it.
		</p>
		<p class="cost-aside">
			If you have used an agentic coding tool, this works much the same way.
		</p>
	</div>

	<div class="cost-foot">
		<button type="button" onclick={() => generalSettingsStore.setAssistantCostSeen(true)}>
			Got it
		</button>
	</div>
</section>

<style>
	.cost {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: transparent;
	}

	/* Centred in whatever room the panel has, and still scrollable: a panel dragged down to
	   its minimum height, or a phone in landscape, must not clip the last line. */
	.cost-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		padding: 1.5rem 1.25rem;
		text-align: center;
	}

	.cost-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.4rem;
		height: 3.4rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.cost-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.cost-text {
		margin: 0;
		max-width: 24rem;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	/* Quieter than the paragraph above it: the warning stands on its own, and this line is
	   for the readers who already know the shape and can stop reading here. */
	.cost-aside {
		margin: 0;
		max-width: 24rem;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	/* Its own band at the foot of the panel, above the edge the composer would sit on: the
	   one control on screen is where the hand already is. */
	.cost-foot {
		flex-shrink: 0;
		display: flex;
		justify-content: center;
		padding: 0.75rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.cost-foot button {
		padding: 0.45rem 1.6rem;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: filter 120ms ease;
	}

	.cost-foot button:hover {
		filter: brightness(1.08);
	}
</style>
