/**
 * The dispatcher: find every marker in a piece of entry text, route each to its framework,
 * and replace it with what that framework computed.
 *
 * This is the whole of the base's runtime. It knows nothing about what any framework
 * computes: only how to find a marker, who claims it, and what to do when nobody does.
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
	byId: Map<string, FrameworkDef>
): Resolution {
	const base = { raw: marker.raw, frameworkId: marker.frameworkId, key: marker.key };

	if (marker.error) {
		return { replacement: '', record: { ...base, status: 'malformed', reason: marker.error } };
	}
	// Non-null once `error` is null, but the type does not know that.
	const key = marker.key as string;

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

	const out = framework.compute({
		key,
		subject: marker.subject as string,
		fields: marker.fields,
		day: ctx.day,
		state: ctx.byFramework[framework.id]
	});
	// A framework answering with blank space is saying nothing, and recording that as
	// `rendered` would put an empty row in the panel claiming text reached the prompt.
	if (out === null || out.trim() === '') {
		return { replacement: '', record: { ...base, status: 'noOutput' } };
	}
	return { replacement: out, record: { ...base, status: 'rendered', text: out } };
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
			const { replacement, record } = resolveOne(marker, ctx, byId);
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
