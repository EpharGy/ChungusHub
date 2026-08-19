<script lang="ts">
	/**
	 * The activity line is the one live element of a running turn, at the bottom of it, for
	 * the whole turn. Everything above it is content; this is the only thing that moves.
	 *
	 * It answers two questions in one row. **What is happening** is the head: a family
	 * motion while a call is in flight, the cursive while the reply is arriving, the ellipsis
	 * while the model itself is working (reasoning, or a silent wait), with a phrase beside
	 * it, except while reasoning, where the block above is already titled "Thinking…" and a
	 * phrase would only say it again.
	 *
	 * **Whether anything is actually happening** is the trail: it advances one tick per burst
	 * of real activity (reply tokens, reasoning tokens, tool-call argument frames, a step
	 * landing), plus a beat of its own for as long as a call is in flight, which is progress
	 * the client can see even when no bytes are moving. What it will not do is tick while the
	 * turn is waiting on the model: that is the one state where nothing is observable, so a
	 * stalled provider shows a frozen trail rather than a spinner turning over a dead socket.
	 *
	 * The head keeps breathing while the trail is frozen, deliberately: a wait is not a
	 * failure, and a completely still row reads as a crash. Motion means alive; the trail
	 * advancing means productive. Those are different facts and the row states both.
	 *
	 * Rendering is bounded by construction, because this sits on the ~7-frames-a-second
	 * path: the trail is a fixed number of fixed-size ticks (only their opacity changes),
	 * the phrase is one clipped line that never wraps, and advances are throttled, so no
	 * amount of streaming can resize the row or move the timeline above it.
	 */
	import AssistantWorkMotion from './AssistantWorkMotion.svelte';
	import { motionFor, WORK_WORDS, type WorkMotion } from '$lib/config/assistant-motion';
	import type { AssistantSessionRuntime } from '$lib/types/assistant';

	let { runtime }: { runtime: AssistantSessionRuntime } = $props();

	/** Enough ticks to read as a trail, few enough to stay under a phrase's width. */
	const TICKS = 12;
	/** How many ticks behind the head still glow, brightest first. */
	const TAIL = 5;
	/** One tick per this much activity at most: token deltas arrive far faster than an eye
	 *  can follow, and an unthrottled trail would be a blur that says nothing. */
	const ADVANCE_MS = 110;
	/** The beat a call in flight keeps on its own. Comfortably above the throttle, so every
	 *  beat lands instead of being eaten by timer jitter. */
	const BEAT_MS = 150;
	const ROTATE_MS = 4600;
	const TICK_INDEXES = Array.from({ length: TICKS }, (_, i) => i);
	/** Held on a card: one line, never rotated. See `words` below. */
	const HELD_WORDS = ['waiting for you'];

	/** A card outranks everything, then a running call: both are more specific than the
	 *  trailing step, which otherwise says whether the model is writing, reasoning, or silent. */
	let mode = $derived.by<'held' | 'call' | 'writing' | 'reasoning' | 'waiting'>(() => {
		if (runtime.pending) return 'held';
		if (runtime.running.length) return 'call';
		const last = runtime.steps[runtime.steps.length - 1];
		if (last?.kind === 'text') return 'writing';
		if (last?.kind === 'thinking') return 'reasoning';
		return 'waiting';
	});

	/** Results arrive in call order, so the oldest un-retired row is the work in progress. */
	let motion = $derived.by<WorkMotion>(() => {
		if (mode === 'call') return motionFor(runtime.running[0].name);
		if (mode === 'writing') return 'write';
		return 'idle';
	});

	/**
	 * Held on a card, the mark stops moving. Motion means the assistant is alive and working,
	 * and here it is neither: it has stopped and the next move is the user's. A breathing head
	 * over a card that needs answering is the one state where "alive" reads as "leave it alone".
	 */
	let stillHead = $derived(mode === 'held');

	/**
	 * Reasoning says nothing here: the block above it is already titled "Thinking…", and a
	 * phrase under that title is the same word twice. The ellipsis and the trail carry it.
	 * Held is the other exception, and the opposite kind: it gets ONE fixed line rather than a
	 * rotation, because a phrase that changes every few seconds claims work is going on.
	 * Otherwise the identity is stable per phase (a module constant), so the rotation restarts
	 * when the phase changes and not on every delta that flows through.
	 */
	let words = $derived(mode === 'reasoning' ? null : mode === 'held' ? HELD_WORDS : WORK_WORDS[motion]);

	/**
	 * Monotonic while anything is arriving, still when nothing is. Cheap by construction:
	 * it counts string LENGTHS over a handful of steps, never the characters themselves.
	 */
	let activity = $derived.by(() => {
		let n = runtime.steps.length;
		for (const step of runtime.steps) if (step.kind !== 'tool') n += step.text.length;
		for (const call of runtime.running) n += call.text.length;
		return n;
	});

	let head = $state(-1);
	let word = $state(WORK_WORDS.idle[0]);

	// Plain mirrors: an $effect that READ the state it writes would re-trigger itself.
	let headAt = -1;
	// Seeded to now, so mounting is not itself an advance: the trail starts empty and the
	// first tick lights up when the first real token arrives.
	let advancedAt = Date.now();

	function advance() {
		const now = Date.now();
		if (now - advancedAt < ADVANCE_MS) return;
		advancedAt = now;
		headAt = (headAt + 1) % TICKS;
		head = headAt;
	}

	// Anything observable arriving: reply tokens, reasoning tokens, argument frames, a step.
	$effect(() => {
		void activity;
		advance();
	});

	// A call in flight is progress the client can see without a single byte arriving: the
	// loop is inside a tool, not sitting on a socket. It needs its own beat because short
	// arguments (an id, a name) derive no line at all and server-side execution emits
	// nothing, so a whole call would otherwise pass with the trail frozen, which reads as a
	// hang. The pure wait keeps no beat: that freeze is the honest one.
	$effect(() => {
		if (!runtime.running.length) return;
		const id = setInterval(advance, BEAT_MS);
		return () => clearInterval(id);
	});

	/** Never the same phrase twice running: a repeat reads as a stuck indicator. A single-line
	 *  list (held) is exempt: there is nothing to rotate to, which is the point of it. */
	function next(current: string, from: string[]): string {
		if (from.length < 2) return from[0];
		let pick = current;
		while (pick === current) pick = from[Math.floor(Math.random() * from.length)];
		return pick;
	}

	$effect(() => {
		const from = words;
		if (!from) {
			word = '';
			return;
		}
		word = next('', from);
		// A single-phrase phase has nothing to rotate to, so it keeps no timer.
		if (from.length < 2) return;
		const id = setInterval(() => (word = next(word, from)), ROTATE_MS);
		return () => clearInterval(id);
	});

	/** Full at the head, fading over TAIL ticks behind it, dim everywhere else. */
	function glow(i: number): number {
		if (head < 0) return 0.1;
		const behind = (head - i + TICKS) % TICKS;
		if (behind >= TAIL) return 0.1;
		return 1 - behind * (0.82 / TAIL);
	}
</script>

<div class="activity">
	<AssistantWorkMotion {motion} still={stillHead} />
	<!-- Keyed so each new phrase fades in on its own; the row never changes height. -->
	{#if word}
		{#key word}
			<span class="activity-word" aria-hidden="true">{word}</span>
		{/key}
	{/if}
	<span class="sr-only">{mode === 'held' ? 'Waiting for your approval' : 'Working'}</span>
	<span class="activity-trail" aria-hidden="true">
		{#each TICK_INDEXES as i (i)}
			<span class="activity-tick" style:opacity={glow(i)}></span>
		{/each}
	</span>
</div>

<style>
	/* The timeline's glyph rail is the action row's own inset (its pill's left padding), so
	   this line carries the same one: the head sits in the column every icon above it sits
	   in, and the trail ends where those rows end. */
	.activity {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0 0.45rem;
		/* Sits apart from the log above it: this is the turn's state, not another entry in
		   its history, and at the timeline's own gap it read as one more row. */
		margin-top: 0.35rem;
		font-size: 0.76rem;
		color: var(--color-text-muted);
	}

	.activity-word {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		animation: activity-word-in 260ms ease-out;
	}

	/* Parked at the right edge so a phrase changing width never shifts it sideways. */
	.activity-trail {
		flex: 0 0 auto;
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 1.5px;
	}

	.activity-tick {
		width: 2px;
		height: 7px;
		border-radius: 1px;
		background: var(--color-accent);
		transition: opacity 90ms linear;
	}

	@keyframes activity-word-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	/* The trail is data, not decoration, so it keeps working. It just stops easing. */
	@media (prefers-reduced-motion: reduce) {
		.activity-word { animation: none; }
		.activity-tick { transition: none; }
	}
</style>
