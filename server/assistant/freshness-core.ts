/**
 * Freshness core: the pure half of the assistant's staleness tracking.
 *
 * A CLAIM is one entry of a `stateRevs` map inside a persisted tool result: "this
 * conversation holds a view of <kind>:<id> as of content revision <rev>". The db-backed
 * half (freshness.ts) computes revisions and compares claims against the workspace;
 * this module owns everything that needs no database: the hash, reading claims back
 * out of a conversation, and the state note's format, including parsing the notes it
 * wrote itself, which is what keeps one change from being announced every turn.
 *
 * Zero imports on purpose (the toolProgress.ts precedent): `bun test` reaches it
 * without touching server config, which creates the data directory at import time.
 */

/** The claim key for one tracked thing. */
export function claimKey(kind: string, id: string): string {
	return `${kind}:${id}`;
}

/** The revision a delete stamps, and what a missing row reads as at check time. */
export const REV_GONE = 'gone';

/**
 * Content hash for a revision: djb2 and sdbm over the same serialization, base36,
 * ~64 bits total. Deterministic and dependency-free; collisions are birthday-remote,
 * which is plenty for "did this one thing change since I read it".
 */
export function revHash(input: unknown): string {
	const s = JSON.stringify(input);
	if (typeof s !== 'string') throw new Error('revHash input does not serialize.');
	let a = 5381;
	let b = 0;
	for (let i = 0; i < s.length; i += 1) {
		const c = s.charCodeAt(i);
		a = ((a << 5) + a + c) | 0;
		b = (c + (b << 6) + (b << 16) - b) | 0;
	}
	return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** Marks the loop's state note; matched as a prefix, like the trim and revocation notes. */
export const STATE_NOTE_PREFIX = '(state note:';

/**
 * Marks the loop's workspace note (buildWorkspaceNote in loop.ts), the second
 * claim-bearing system message: content the user attaches in full is a genuine read, so
 * the note stamps the same claims a read would. Shared from here because the scan below
 * and the note builder must agree on the string, and a drifted copy would silently stop
 * every attachment claim from registering.
 */
export const WORKSPACE_NOTE_PREFIX = '# Open in the workspace';

/**
 * One machine-readable token inside a state note: `[kind:id rev:xyz]`. The note both
 * tells the model something moved AND records the revision it moved to, so the scan
 * reads its own notes back as claims: announced once, silent until the next change.
 */
const NOTE_TOKEN = /\[([a-z_]+):([^\s\]]+) rev:([^\s\]]+)\]/g;

/** The slice of a conversation message this module reads. LLMToolMessage satisfies it. */
export interface ClaimSource {
	role: string;
	content: string;
}

/**
 * Every claim in a conversation, later ones superseding earlier: a fresh read outranks
 * an old one, a write's stamp outranks the read it followed, and a state note's
 * announced revision outranks the stale claim it warned about. Trimming drops claims
 * with the turns that made them: the scan and the model read the same artifact, so
 * they forget together and no claim can outlive the knowledge it vouches for.
 */
export function collectStateClaims(conversation: ClaimSource[]): Map<string, string> {
	const claims = new Map<string, string>();
	for (const m of conversation) {
		if (m.role === 'tool') {
			// Cheap pre-filter: most tool results carry no stamps, and the biggest ones
			// (whole chat reads) are the costliest to parse for nothing.
			if (!m.content.includes('"stateRevs"')) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(m.content);
			} catch {
				// Not JSON. The model cannot read it as a result either, so it claims nothing;
				// an unregistered claim only ever means one more re-read, the safe direction.
				continue;
			}
			const revs = (parsed as { stateRevs?: unknown } | null)?.stateRevs;
			if (!revs || typeof revs !== 'object' || Array.isArray(revs)) continue;
			for (const [key, rev] of Object.entries(revs)) {
				if (typeof rev === 'string' && key.includes(':')) claims.set(key, rev);
			}
		} else if (m.role === 'system' && m.content.startsWith(STATE_NOTE_PREFIX)) {
			for (const match of m.content.matchAll(NOTE_TOKEN)) {
				claims.set(`${match[1]}:${match[2]}`, match[3]);
			}
		} else if (m.role === 'system' && m.content.startsWith(WORKSPACE_NOTE_PREFIX)) {
			// Claims ride the note's HEADER LINE only. The body quotes user content (a chat
			// selection, card fields) and a token forged there would register a claim that
			// suppresses a re-read, which is the unsafe direction; the header is app-written.
			const nl = m.content.indexOf('\n');
			const header = nl === -1 ? m.content : m.content.slice(0, nl);
			for (const match of header.matchAll(NOTE_TOKEN)) {
				claims.set(`${match[1]}:${match[2]}`, match[3]);
			}
		}
	}
	return claims;
}

/** One stale thing, ready to be named in the note. */
export interface StaleEntry {
	/** Human-noun label for the model ('character "Aria"'). */
	label: string;
	/** The row no longer exists. */
	gone: boolean;
	/** The claim tokens this clause carries: every one is re-claimed by the note itself. */
	refs: { key: string; rev: string }[];
}

/**
 * The state note the loop pins after the user turn when claimed state has moved.
 * Prompt text, read by the model only; the tokens are its self-claim (see NOTE_TOKEN).
 *
 * The note fires only for changes that were NOT the assistant's own (its writes re-claim
 * what they touched), and it must SAY so: told only "this moved, re-read it", a model can
 * read the user's hand edit as damage and restore its own earlier version, the exact
 * overwrite this machinery exists to prevent. One sentence carries it: not yours, they
 * stand, name a collision instead of undoing it.
 */
export function formatStateNote(stale: StaleEntry[]): string {
	const clauses = stale.map((s) => {
		const tokens = s.refs.map((r) => `[${r.key} rev:${r.rev}]`).join(' ');
		return `${s.label} ${s.gone ? 'was deleted' : 'changed'} ${tokens}`;
	});
	return `${STATE_NOTE_PREFIX} things you read earlier in this conversation have since changed in the workspace. Re-read these before relying on or editing them: ${clauses.join('; ')}. These changes are not yours and they stand; if one collides with what you were asked to do, say so rather than undoing it. Seq numbers taken from a changed chat may have moved. Everything NOT named here is unchanged: no need to re-read it.)`;
}
