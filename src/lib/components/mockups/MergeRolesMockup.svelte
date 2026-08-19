<!--
  MergeRolesMockup: animated demo for the "Merge consecutive roles" toggle.

  The mock toggle at the top flips Off <-> On so it's unmistakable which state
  is which:
    - Off: three messages, each kept as its own turn.
    - On: the two back-to-back SYSTEM turns fuse into one (joined by a blank-line
      seam, exactly like the real merge); the USER turn below stays separate
      because its role differs. Counter ticks 3 <-> 2 in step.

  Pure CSS animation; it exists only while the tip is open.
-->
<div class="demo" aria-hidden="true">
	<div class="head">
		<span class="switch"><span class="knob"></span></span>
		<span class="state">
			<span class="lbl off">Off</span>
			<span class="lbl on">On</span>
		</span>
		<span class="count">
			<span class="c c3">3 blocks</span>
			<span class="c c2">2 blocks</span>
		</span>
	</div>

	<div class="cards">
		<div class="card system s1">
			<span class="badge">system</span>
			<span class="txt">You are the narrator.</span>
		</div>
		<div class="card system s2">
			<span class="seam"></span>
			<span class="badge">system</span>
			<span class="txt">Always reply in second person.</span>
		</div>
		<div class="card user u1">
			<span class="badge">user</span>
			<span class="txt">I push the tavern door open.</span>
		</div>
	</div>
</div>

<style>
	.demo {
		--dur: 6.6s;
		--sys: #60a5fa;
		--usr: #4ade80;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.65rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
		border: 1px solid var(--color-border-subtle);
	}

	/* ── Header: the toggle that names the state ───────────────────────── */
	.head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.switch {
		position: relative;
		flex-shrink: 0;
		width: 34px;
		height: 18px;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: var(--color-bg-tertiary);
		animation: switch-track var(--dur) ease-in-out infinite;
	}
	.knob {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 35%);
		animation: knob-slide var(--dur) cubic-bezier(0.22, 1, 0.36, 1) infinite;
	}

	.state {
		position: relative;
		width: 1.8rem;
		height: 0.95rem;
	}
	.lbl {
		position: absolute;
		left: 0;
		top: 0;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.72rem;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.lbl.off {
		color: var(--color-text-muted);
		animation-name: lbl-off;
	}
	.lbl.on {
		color: var(--color-accent);
		animation-name: lbl-on;
	}

	.count {
		position: relative;
		margin-left: auto;
		height: 1.05rem;
		min-width: 5.6rem;
	}
	.c {
		position: absolute;
		right: 0;
		top: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.64rem;
		letter-spacing: 0.02em;
		white-space: nowrap;
		border-radius: var(--radius-full);
		padding: 0.05rem 0.5rem;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.c.c3 {
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		border: 1px solid var(--color-border-subtle);
		animation-name: c3-out;
	}
	.c.c2 {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		animation-name: c2-in;
	}

	/* ── Cards ─────────────────────────────────────────────────────────── */
	.cards {
		display: flex;
		flex-direction: column;
	}

	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
		padding: 0.45rem 0.6rem;
		border-left: 2px solid var(--role);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--role) 8%, var(--color-bg-secondary) 70%);
	}
	.system {
		--role: var(--sys);
	}
	.user {
		--role: var(--usr);
	}

	.badge {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.6rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--role);
	}

	.txt {
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	/* The blank-line join that appears only once the system cards fuse. */
	.seam {
		display: block;
		height: 0;
		margin: 0;
		border-top: 1px dashed color-mix(in srgb, var(--sys) 55%, transparent);
		opacity: 0;
		animation: seam-in var(--dur) ease-in-out infinite;
	}

	.u1 {
		margin-top: 0.45rem;
	}

	.s1,
	.s2,
	.s2 .badge {
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.s1 {
		animation-name: s1-join;
	}
	.s2 {
		margin-top: 0.45rem;
		animation-name: s2-merge;
	}
	/* Collapses the second SYSTEM label so the pair reads as one message. */
	.s2 .badge {
		overflow: hidden;
		animation-name: badge-collapse;
	}

	/* ── Timeline: long holds, snappy flips ──────────────────────────────
	   Off held 0–18% & 80–100%, flip to On 18–31%, On held 31–67%,
	   flip back 67–80%. Holds ~2.4s each, flips ~0.85s at --dur 6.6s. */
	@keyframes switch-track {
		0%, 18% { background: var(--color-bg-tertiary); border-color: var(--color-border); }
		31%, 67% { background: var(--color-accent); border-color: transparent; }
		80%, 100% { background: var(--color-bg-tertiary); border-color: var(--color-border); }
	}
	@keyframes knob-slide {
		0%, 18% { transform: translateX(0); }
		31%, 67% { transform: translateX(16px); }
		80%, 100% { transform: translateX(0); }
	}

	@keyframes lbl-off {
		0%, 18% { opacity: 1; }
		28%, 70% { opacity: 0; }
		80%, 100% { opacity: 1; }
	}
	@keyframes lbl-on {
		0%, 22% { opacity: 0; }
		31%, 67% { opacity: 1; }
		77%, 100% { opacity: 0; }
	}

	@keyframes c3-out {
		0%, 20% { opacity: 1; }
		31%, 68% { opacity: 0; }
		79%, 100% { opacity: 1; }
	}
	@keyframes c2-in {
		0%, 22% { opacity: 0; }
		33%, 67% { opacity: 1; }
		78%, 100% { opacity: 0; }
	}

	@keyframes s1-join {
		0%, 18% {
			border-bottom-left-radius: var(--radius-sm);
			border-bottom-right-radius: var(--radius-sm);
		}
		31%, 67% {
			border-bottom-left-radius: 0;
			border-bottom-right-radius: 0;
		}
		80%, 100% {
			border-bottom-left-radius: var(--radius-sm);
			border-bottom-right-radius: var(--radius-sm);
		}
	}

	@keyframes s2-merge {
		0%, 18% {
			margin-top: 0.45rem;
			border-top-left-radius: var(--radius-sm);
			border-top-right-radius: var(--radius-sm);
		}
		31%, 67% {
			margin-top: 0;
			border-top-left-radius: 0;
			border-top-right-radius: 0;
		}
		80%, 100% {
			margin-top: 0.45rem;
			border-top-left-radius: var(--radius-sm);
			border-top-right-radius: var(--radius-sm);
		}
	}

	@keyframes badge-collapse {
		0%, 18% { max-height: 1rem; opacity: 1; margin-bottom: 0.15rem; }
		31%, 68% { max-height: 0; opacity: 0; margin-bottom: 0; }
		80%, 100% { max-height: 1rem; opacity: 1; margin-bottom: 0.15rem; }
	}

	@keyframes seam-in {
		0%, 20% { opacity: 0; margin: 0; }
		33%, 67% { opacity: 1; margin: 0.14rem 0; }
		78%, 100% { opacity: 0; margin: 0; }
	}

	/* No motion: settle on the On (merged) end-state so the payoff still reads. */
	@media (prefers-reduced-motion: reduce) {
		.switch,
		.knob,
		.lbl,
		.c,
		.s1,
		.s2,
		.s2 .badge,
		.seam {
			animation: none;
		}
		.switch { background: var(--color-accent); border-color: transparent; }
		.knob { transform: translateX(16px); }
		.lbl.off { opacity: 0; }
		.lbl.on { opacity: 1; }
		.c.c3 { opacity: 0; }
		.c.c2 { opacity: 1; }
		.s1 { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
		.s2 { margin-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
		.s2 .badge { max-height: 0; opacity: 0; margin-bottom: 0; overflow: hidden; }
		.seam { opacity: 1; margin: 0.14rem 0; }
	}
</style>
