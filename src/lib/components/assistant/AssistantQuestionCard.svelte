<script lang="ts">
	/**
	 * The questions a paused turn is waiting on, above the composer and deliberately NOT a
	 * modal. It takes the same slot and the same reasoning as the approval card: the user must
	 * be able to scroll the transcript and read the chat behind the panel while they decide.
	 * While a turn runs the composer's send button is a Stop, so this card's own controls are
	 * the only way to answer at all.
	 *
	 * One question per card, stepped through. Answers and typed text are held for the whole
	 * series, so going back to card 1 shows what was chosen there, and nothing is sent until
	 * every card has an answer and the user says so: the server takes exactly one outcome, and
	 * the assistant asked because it needs all of them.
	 *
	 * The free-text box is the panel's, not the model's: the schema forbids an "other" option
	 * precisely because this row is always here. In a single-choice question it behaves like
	 * the classic "Other:" radio (typing in it deselects the options, and picking an option
	 * releases it without erasing the text); in a multiple-choice one it rides ALONG with the
	 * ticks, because "these two, plus this" is how the answer actually comes out. Every option
	 * also carries a button that drops its words into the box: the commonest answer of all is
	 * one of the four with a change to it, and without that button the user either retypes the
	 * whole option or settles for the one that is not quite right.
	 *
	 * The parent keys this component on the card's `askId`, so the next card of the turn
	 * arrives as a fresh instance with nothing decided.
	 */
	import { tick } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { AssistantQuestion, AssistantQuestionAnswer } from '$lib/services/transport';

	let {
		questions,
		onRespond
	}: {
		questions: AssistantQuestion[];
		onRespond: (answers: AssistantQuestionAnswer[]) => void;
	} = $props();

	/** Which card is on screen. Answers live outside it, so stepping never loses one. */
	let step = $state(0);
	/** Option labels ticked per question index. Labels, not positions: they are what the model
	 *  wrote and what it reads back, so nothing has to be re-resolved at either end. */
	let picks = $state<Record<number, string[]>>({});
	/** Whatever the user typed per question index, kept even while an option is selected. */
	let typed = $state<Record<number, string>>({});
	/** Single-choice only: the box is the chosen answer rather than one of the options. */
	let typedWins = $state<Record<number, boolean>>({});
	/** The answers have left this device. The card stays up for the round trip, so its
	 *  controls must stop answering: the server ignores a second answer, but the user
	 *  should not be able to aim one. */
	let sent = $state(false);
	/** The box itself, so an option's words can land at the caret and leave it there. */
	let boxEl = $state<HTMLInputElement | null>(null);

	let current = $derived(questions[step]);
	let multiple = $derived(current?.multiple === true);

	function textOf(i: number): string {
		return (typed[i] ?? '').trim();
	}

	/** A question is answered once it has something to send: a tick, or typed words. */
	function answered(i: number): boolean {
		const q = questions[i];
		if (!q) return false;
		if (q.multiple) return (picks[i]?.length ?? 0) > 0 || !!textOf(i);
		return typedWins[i] ? !!textOf(i) : (picks[i]?.length ?? 0) > 0;
	}

	let remaining = $derived(questions.filter((_, i) => !answered(i)).length);
	let complete = $derived(remaining === 0);
	let firstUnanswered = $derived(questions.findIndex((_, i) => !answered(i)));

	function isPicked(i: number, option: string): boolean {
		return (picks[i] ?? []).includes(option);
	}

	function toggle(option: string): void {
		if (sent) return;
		const chosen = picks[step] ?? [];
		if (multiple) {
			picks = { ...picks, [step]: chosen.includes(option) ? chosen.filter((o) => o !== option) : [...chosen, option] };
			return;
		}
		// Single choice: picking releases the box without clearing it, so a long typed answer
		// survives a stray click and can be taken back with one more.
		picks = { ...picks, [step]: [option] };
		typedWins = { ...typedWins, [step]: false };
		// One tap answers the whole card, so the series moves on by itself. Only here: a
		// multiple-choice card is not finished by its first tick, and the last card has
		// nowhere to go: it waits for the send, which is the one gesture that commits.
		go(step + 1);
	}

	/** Typing takes the answer in a single-choice question; in a multiple-choice one it simply
	 *  adds to the ticks, so nothing needs releasing. */
	function onType(value: string): void {
		typed = { ...typed, [step]: value };
		if (!multiple) typedWins = { ...typedWins, [step]: value.trim().length > 0 };
	}

	function claimBox(): void {
		if (sent || multiple || !textOf(step)) return;
		typedWins = { ...typedWins, [step]: true };
	}

	/**
	 * Drops an option's words into the box so the user can change them. Neither picking nor
	 * typing handles that case on its own: the answer is right except for one part of it, and
	 * retyping the whole thing to say so is what makes people settle for the wrong option.
	 *
	 * It lands at the caret rather than replacing the box, so it can never eat something
	 * already typed, and it never advances the card: the user is about to write.
	 */
	async function take(option: string): Promise<void> {
		if (sent) return;
		const text = typed[step] ?? '';
		const from = boxEl?.selectionStart ?? text.length;
		const to = boxEl?.selectionEnd ?? text.length;
		onType(text.slice(0, from) + option + text.slice(to));
		// In a multiple-choice card the box rides ALONGSIDE the ticks, so an option that has
		// moved into it must leave them: the model would otherwise read the same answer twice,
		// once as picked and once as written, in two different wordings.
		if (multiple) picks = { ...picks, [step]: (picks[step] ?? []).filter((o) => o !== option) };
		await tick();
		boxEl?.focus();
		boxEl?.setSelectionRange(from + option.length, from + option.length);
	}

	function answerOf(i: number): AssistantQuestionAnswer {
		const q = questions[i];
		const text = textOf(i);
		if (q.multiple) return { picked: picks[i] ?? [], written: text || null };
		if (typedWins[i] && text) return { picked: [], written: text };
		return { picked: picks[i] ?? [], written: null };
	}

	function send(): void {
		if (sent || !complete) return;
		sent = true;
		onRespond(questions.map((_, i) => answerOf(i)));
	}

	function go(to: number): void {
		if (to >= 0 && to < questions.length) step = to;
	}

	/** Enter moves the series on rather than submitting a half-answered card: the next card if
	 *  there is one, the first still missing an answer if there is not, and the send otherwise. */
	function onBoxKey(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		if (complete) send();
		else if (firstUnanswered >= 0 && firstUnanswered !== step) go(firstUnanswered);
		else if (step + 1 < questions.length) go(step + 1);
	}
</script>

<section class="ask" aria-label="Questions from the assistant">
	<header class="ask-head">
		<Icon name="annotation" class="w-3.5 h-3.5 shrink-0" />
		<span class="ask-title" aria-live="polite">
			{questions.length === 1 ? 'The assistant is asking' : `The assistant is asking ${questions.length} things`}
		</span>
		{#if questions.length > 1}
			<span class="ask-count">{step + 1} / {questions.length}</span>
		{/if}
	</header>

	<p class="ask-question panel-scroll">{current.question}</p>

	<div class="ask-body panel-scroll">
		<div class="ask-options" role={multiple ? 'group' : 'radiogroup'}>
			{#each current.options as option (option)}
				<div class="ask-row" class:ask-row--on={isPicked(step, option)}>
					<button
						type="button"
						class="ask-option"
						role={multiple ? 'checkbox' : 'radio'}
						aria-checked={isPicked(step, option)}
						disabled={sent}
						onclick={() => toggle(option)}
					>
						<span class="ask-mark" class:ask-mark--box={multiple}>
							{#if isPicked(step, option)}<Icon name="check" class="w-2.5 h-2.5" strokeWidth={3} />{/if}
						</span>
						<span class="ask-option-text">{option}</span>
					</button>
					<button
						type="button"
						class="ask-take"
						disabled={sent}
						onclick={() => void take(option)}
						title="Put these words in the box below and change them"
						aria-label="Write your own answer starting from: {option}"
					>
						<Icon name="download" class="w-3 h-3" />
					</button>
				</div>
			{/each}
		</div>

		<div class="ask-own" class:ask-own--on={!multiple && typedWins[step] && !!textOf(step)}>
			<input
				bind:this={boxEl}
				type="text"
				class="ask-input"
				value={typed[step] ?? ''}
				disabled={sent}
				placeholder={multiple ? 'Add something of your own' : 'Or write your own answer'}
				aria-label={multiple ? 'Add your own answer' : 'Write your own answer'}
				oninput={(e) => onType(e.currentTarget.value)}
				onfocus={claimBox}
				onkeydown={onBoxKey}
			/>
		</div>
	</div>

	<footer class="ask-foot">
		{#if questions.length > 1}
			<button type="button" class="ask-nav" disabled={step === 0} onclick={() => go(step - 1)} aria-label="Previous question">
				<Icon name="chevronLeft" class="w-3.5 h-3.5" />
			</button>
			<button
				type="button"
				class="ask-nav"
				disabled={step === questions.length - 1}
				onclick={() => go(step + 1)}
				aria-label="Next question"
			>
				<Icon name="chevronRight" class="w-3.5 h-3.5" />
			</button>
		{/if}
		<span class="ask-left">
			{#if !complete}{remaining === 1 ? '1 still needs an answer' : `${remaining} still need an answer`}{/if}
		</span>
		<button type="button" class="ask-send" disabled={sent || !complete} onclick={send}>
			{questions.length === 1 ? 'Send answer' : 'Send answers'}
		</button>
	</footer>
</section>

<style>
	.ask {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 88%, transparent);
	}

	.ask-head {
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

	.ask-title {
		flex: 1;
		min-width: 0;
	}

	.ask-count {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	/* Capped and scrolling its own body, like the approval card: a long question with four
	   long options must not push the composer off the panel. */
	.ask-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		max-height: 15rem;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	/* Outside the scroller, deliberately: four long options scroll, and a question that
	   scrolls away with them leaves the reader picking an answer to something they can no
	   longer see. Capped so a pathologically long one still leaves the options on screen. */
	.ask-question {
		flex-shrink: 0;
		max-height: 6rem;
		overflow-y: auto;
		padding: 0.5rem 0.5rem 0;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		line-height: 1.35;
		color: var(--color-text-primary);
	}

	.ask-options {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	/* The border belongs to the ROW, not the option, so the take button sits inside the same
	   outline: it acts on that option and would read as a loose control beside it otherwise. */
	.ask-row {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
	}

	.ask-row:hover {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: var(--color-text-primary);
	}

	.ask-row--on {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-text-primary);
	}

	.ask-option {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.35rem 0.45rem;
		border: 0;
		background: transparent;
		color: inherit;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.3;
		text-align: left;
		cursor: pointer;
	}

	.ask-option:disabled,
	.ask-take:disabled {
		opacity: 0.55;
		cursor: default;
	}

	/* Quiet by default and never hover-only: on a phone there is no hover, and a control that
	   only exists under a pointer is one half the users never find. */
	.ask-take {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding: 0 0.4rem;
		border: 0;
		border-left: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.ask-take:hover:not(:disabled) {
		color: var(--color-accent);
	}

	/* Round for the one-of, square for the several-of: the shape says which kind of question
	   this is before the user finds out by clicking twice. */
	.ask-mark {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 0.85rem;
		height: 0.85rem;
		margin-top: 0.1rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		opacity: 0.7;
	}

	.ask-mark--box {
		border-radius: var(--radius-sm);
	}

	.ask-option-text {
		min-width: 0;
	}

	.ask-own {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
	}

	.ask-own--on {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	.ask-input {
		width: 100%;
		padding: 0.35rem 0.45rem;
		border: 0;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
	}

	.ask-input:focus {
		outline: none;
	}

	.ask-foot {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.5rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.ask-nav {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.ask-nav:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.ask-left {
		flex: 1;
		min-width: 0;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ask-send {
		flex-shrink: 0;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
	}

	.ask-send:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
