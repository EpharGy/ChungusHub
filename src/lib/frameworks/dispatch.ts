/**
 * The dispatcher: find every marker in a piece of entry text, route each to its framework,
 * and replace it with what that framework computed.
 *
 * This is the whole of the base's runtime. It knows nothing about what any framework
 * computes: only how to find a marker, who claims it, and what to do when nobody does.
 *
 * It runs in TWO passes over the entry, not one. The first collects the modifier markers a
 * framework declared it reads (`FrameworkDef.modifierIds`); the second resolves everything
 * line by line. That ordering is the whole reason the first pass exists: a modifier changes
 * what another marker renders, so it has to be known before that other marker is computed,
 * and two markers in one description have no order an author would think to get right.
 * Steering's modifiers arrive already gathered, in `ctx.modifiers`, and sit on top.
 *
 * **An unconsumed marker is REMOVED, never passed through.** Framework off, subject
 * suppressed, id misspelled, body malformed: the marker still goes, and what is left is
 * either the computed line or nothing. This is a deliberate departure from the macro
 * engine's "unknown names stay literal so typos surface" rule, and the two are different
 * kinds of thing: a macro typo is the author's own prose and belongs on screen, while a
 * marker is machine configuration that is noise in a prompt under every circumstance.
 * What replaces "surface the typo" is the record list, which says exactly what happened
 * to every marker whether or not it produced text.
 *
 * Pure: no stores, no db, no Svelte, no clock, no randomness. Everything it needs arrives
 * in the FrameworkContext, for the reason `resolveLorebooks` takes its books rather than
 * reaching for them. The token meters and the real send both run this, and they must
 * produce byte-identical output.
 *
 * See architecture/frameworks.md.
 */
import { findMarkers, hasMarker } from './marker';
import type {
	FrameworkApplication,
	FrameworkContext,
	FrameworkDef,
	FrameworkRecord
} from './types';

/** What one marker resolved to: the text that replaces it, plus the record explaining why. */
interface Resolution {
	replacement: string;
	record: FrameworkRecord;
}

function resolveOne(
	marker: ReturnType<typeof findMarkers>[number],
	ctx: FrameworkContext,
	byId: Map<string, FrameworkDef>,
	/** Modifier marker id -> the framework that declared it reads that id. */
	modifierOwner: Map<string, string>,
	/** Everything modifying one subject: this entry's own modifier markers under the
	 *  steering's, already merged. */
	modifiersFor: (key: string) => Readonly<Record<string, Readonly<Record<string, string>>>>
): Resolution {
	const plain = {
		raw: marker.raw,
		frameworkId: marker.frameworkId,
		key: marker.key,
		subject: marker.subject
	};

	if (marker.error) {
		return { replacement: '', record: { ...plain, status: 'malformed', reason: marker.error } };
	}
	// Non-null once `error` is null, but the type does not know that.
	const key = marker.key as string;

	// What is known about HER, attached to every record from here on: a reader opens the panel
	// to find out why a line says what it says, and "she is on something" is half that answer
	// even when the marker went on to be suppressed or switched off.
	const mods = modifiersFor(key);
	const base = Object.keys(mods).length > 0 ? { ...plain, modifiers: mods } : plain;

	// A MODIFIER marker: an id some framework declared in `modifierIds`. It renders nothing
	// and is removed wherever it is written, which is the dispatcher's ordinary rule; what the
	// declaration buys is that it is removed as something UNDERSTOOD rather than reported as a
	// misspelling nobody claims. Its fields were read in the pre-pass and have already reached
	// whatever computes for this subject, so there is nothing left to do but strip it.
	//
	// Checked before `disabled` and `byId` below, because a modifier id is deliberately not a
	// framework id: neither of those lists can answer for it.
	const owner = modifierOwner.get(marker.frameworkId);
	if (owner) {
		// Answered for by its OWNER's switch, not one of its own. A modifier id has no row on
		// the settings page and no switch to throw, so a reader whose modifier stopped working
		// has to be sent to the framework that reads it. That is the only switch there is.
		if (ctx.disabled.includes(owner)) {
			return { replacement: '', record: { ...base, status: 'disabled' } };
		}
		if (ctx.suppressed.includes(key)) {
			return { replacement: '', record: { ...base, status: 'suppressed' } };
		}
		return { replacement: '', record: { ...base, status: 'modifier' } };
	}

	// Disabled is checked before unknown, so a framework that exists but is switched off
	// never reads as a misspelling. The two send someone to completely different places.
	if (ctx.disabled.includes(marker.frameworkId)) {
		return { replacement: '', record: { ...base, status: 'disabled' } };
	}
	const framework = byId.get(marker.frameworkId);
	if (!framework) {
		return { replacement: '', record: { ...base, status: 'unknownFramework' } };
	}
	if (ctx.suppressed.includes(key)) {
		return { replacement: '', record: { ...base, status: 'suppressed' } };
	}

	// A framework that injects a block but claims no marker: it exists, and it has nothing to
	// say about this. `noOutput` is the honest record, and it keeps `unknownFramework` meaning
	// what it says, which is that nobody claims the id at all.
	if (!framework.compute) {
		return { replacement: '', record: { ...base, status: 'noOutput' } };
	}

	const out = framework.compute({
		key,
		subject: marker.subject as string,
		fields: marker.fields,
		day: ctx.day,
		source: ctx.source,
		state: ctx.byFramework[framework.id],
		// This subject's modifier markers, not every subject's: a framework has no business
		// knowing what was said about anyone else, and handing it the whole map would make
		// that a mistake waiting to be made rather than one that cannot be.
		modifiers: mods
	});
	// A framework answering with blank space is saying nothing, and recording that as
	// `rendered` would put an empty row in the panel claiming text reached the prompt.
	if (out === null || out.trim() === '') {
		return { replacement: '', record: { ...base, status: 'noOutput' } };
	}
	return { replacement: out, record: { ...base, status: 'rendered', text: out } };
}

/** Nothing modifies this subject. Frozen and shared, so the overwhelmingly common case
 *  allocates nothing. */
const NO_MODIFIERS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({});

/**
 * Every declared modifier marker in one entry's text, by subject key and then by marker id.
 *
 * Read in a pass of its own, over the WHOLE text, before a single line is resolved. That is
 * the entire point of it: the dispatcher rewrites line by line, so a modifier written under
 * the marker it changes would otherwise be read after that marker had already been computed,
 * and an author has no reason to think the order of two lines in a description matters.
 *
 * Only ids a framework declared are collected. Steering can treat every marker as a modifier
 * because nothing renders there, but an entry is the one place markers DO render, so a
 * misspelt `@fertilty[...]` swallowed as a modifier here would lose the one report that tells
 * the author what went wrong.
 *
 * Malformed markers contribute nothing. They are still stripped, and `resolveOne` reports them.
 */
function collectModifiers(
	text: string,
	modifierOwner: Map<string, string>
): Record<string, Record<string, Record<string, string>>> {
	const found: Record<string, Record<string, Record<string, string>>> = {};
	if (modifierOwner.size === 0) return found;
	for (const marker of findMarkers(text)) {
		if (marker.error || marker.key === null) continue;
		if (!modifierOwner.has(marker.frameworkId)) continue;
		// Last one wins within an entry, matching what steering does with two notes that
		// disagree: the later line is the author's more recent word on it.
		(found[marker.key] ??= {})[marker.frameworkId] = { ...marker.fields };
	}
	return found;
}

/**
 * Apply every framework to one entry's text.
 *
 * Works **line by line**, which the marker grammar makes exact: a marker can never span a
 * newline, so a line is a closed unit. That is what allows the two tidying rules this
 * needs beyond simple replacement, both of which exist because the gap a removed marker
 * leaves behind is invisible to the author and goes to the model anyway:
 *
 *   1. **A stripped marker takes one adjacent space with it**: the one after it, or
 *      failing that the one before. `Cycle: @x[...]` leaves `Cycle:` rather than
 *      `Cycle: `, and `a @x[...] b` leaves `a b` rather than `a  b`.
 *   2. **A line left entirely blank by stripping is dropped**, so a marker sitting alone
 *      on its own line vanishes completely instead of leaving a hole in a description.
 *
 * Neither rule touches a line that had no marker on it. A marker sharing its line with a
 * label still leaves that label behind, because the label is the author's own prose and
 * removing it would be this function editing writing it does not own, so a marker is
 * best given a line of its own.
 */
export function applyFrameworks(text: string, ctx: FrameworkContext): FrameworkApplication {
	if (!text || !hasMarker(text)) return { text, records: [] };

	const byId = new Map(ctx.frameworks.map((framework) => [framework.id, framework]));
	// Which ids are modifier markers, and whose. Derived from the context's own list rather
	// than a second table, so a framework missing from this build takes its modifier ids out
	// with it and they go back to reading as `unknownFramework`, which is then the truth.
	const modifierOwner = new Map<string, string>();
	for (const framework of ctx.frameworks) {
		for (const id of framework.modifierIds ?? []) modifierOwner.set(id, framework.id);
	}
	const local = collectModifiers(text, modifierOwner);
	/**
	 * What modifies one subject: this entry's own modifier markers, with the steering's on
	 * top.
	 *
	 * **Steering wins a disagreement**, and the direction is the point rather than an
	 * accident. An entry is carried by every chat that triggers it, so a modifier written
	 * there is the character's standing fact -- she is on this in general. A steering note
	 * stands over one prompt in one story, so it is the narrower statement, and the narrower
	 * statement is the one an author means when they bother to write both.
	 */
	const modifiersFor = (key: string) => {
		const entry = local[key];
		const steering = ctx.modifiers?.[key];
		if (!entry) return steering ?? NO_MODIFIERS;
		if (!steering) return entry;
		return { ...entry, ...steering };
	};
	const records: FrameworkRecord[] = [];
	const kept: string[] = [];

	for (const line of text.split('\n')) {
		const markers = findMarkers(line);
		if (markers.length === 0) {
			kept.push(line);
			continue;
		}
		// Rebuilt in one pass over the original line, so several markers cannot shift each
		// other's positions the way successive replacements on a mutating string would.
		let out = '';
		let cursor = 0;
		for (const marker of markers) {
			const { replacement, record } = resolveOne(marker, ctx, byId, modifierOwner, modifiersFor);
			let start = marker.index;
			let end = start + marker.raw.length;
			if (!replacement) {
				// A marker that resolves to nothing takes ONE adjacent space with it: the
				// one after it, or failing that the one before. Without this, removing a
				// marker leaves the gap it used to sit in: "Cycle: " with a dangling space,
				// or "a  b" with a doubled one. Both are invisible to the author and both
				// go to the model. Only one space, and only an adjacent one, so the rest of
				// the line's spacing is left exactly as it was written.
				if (line[end] === ' ' || line[end] === '\t') end += 1;
				else if (start > cursor && (line[start - 1] === ' ' || line[start - 1] === '\t')) start -= 1;
			}
			out += line.slice(cursor, start) + replacement;
			cursor = end;
			records.push(record);
		}
		out += line.slice(cursor);
		if (out.trim() === '') continue;
		kept.push(out);
	}

	return { text: kept.join('\n'), records };
}
