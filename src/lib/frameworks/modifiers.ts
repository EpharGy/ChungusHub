/**
 * Modifier markers: the ones that live in steering and change what a marker elsewhere renders.
 *
 * A lorebook entry is decorated, so a marker in one is found by the dispatcher, computed and
 * replaced. Steering is not decorated: it is guidance that rides the prompt verbatim. So a
 * marker written there reaches the model as literal configuration text unless something takes
 * it out, and it is read too late to change anything if the dispatcher finds it, because the
 * entry it modifies has already been resolved by then.
 *
 * This is that something. It runs BEFORE the lorebook is resolved, reads every marker in the
 * steering standing over the prompt, and hands back two things that must travel together: what
 * those markers said, and the same notes with the markers gone.
 *
 * **Every marker in steering is a modifier, and every one is removed.** There is no list of
 * which ids count, deliberately. Nothing in steering can ever render, since no framework is
 * asked to compute there, so a marker left behind is machine configuration reaching the model
 * under every circumstance. That is the dispatcher's rule for an unconsumed marker
 * (architecture/frameworks.md) applied to the one surface the dispatcher does not cover, and
 * it means a framework added later needs no edit here.
 *
 * A framework reads its own id out of the map and ignores the rest, exactly as it reads its own
 * slice of the chat state. The base still knows nothing about what any of it means.
 *
 * Pure: no stores, no db, no Svelte. See architecture/frameworks.md.
 */
import { findMarkers, hasMarker } from './marker';

/** Subject key, then framework id, then that marker's fields verbatim. */
export type ModifierMap = Readonly<
	Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
>;

/** What one scan found, and the notes it found them in with the markers taken out. */
export interface ModifierScan<T> {
	modifiers: ModifierMap;
	/**
	 * The same notes, in the same order, with every marker removed and any note left saying
	 * nothing dropped.
	 *
	 * Returned rather than left to the caller because the two halves are useless apart: taking
	 * the modifiers without the stripped notes ships the markers to the model, and taking the
	 * notes without the modifiers strips a marker that then changes nothing. One call, both.
	 */
	notes: T[];
}

/**
 * Take every marker out of one piece of text, and say what they were.
 *
 * The two tidying rules are the dispatcher's, for the same reason it has them: the gap a
 * removed marker leaves is invisible to whoever wrote it and goes to the model anyway. A
 * stripped marker takes one adjacent space with it, and a line left blank is dropped.
 *
 * A malformed marker is removed as well and contributes nothing. It cannot be reported here
 * the way the dispatcher reports one, because steering has no record list to report into; what
 * it must not do is stay in the prompt.
 */
export function stripModifiers(text: string): { text: string; found: ModifierMap } {
	const found: Record<string, Record<string, Record<string, string>>> = {};
	if (!text || !hasMarker(text)) return { text, found };

	const kept: string[] = [];
	for (const line of text.split('\n')) {
		const markers = findMarkers(line);
		if (markers.length === 0) {
			kept.push(line);
			continue;
		}
		// Rebuilt in one pass over the original line, so several markers on one line cannot
		// shift each other's offsets.
		let out = '';
		let cursor = 0;
		for (const marker of markers) {
			if (marker.key !== null) {
				// Last marker wins for one subject and one framework. Two notes disagreeing about
				// what somebody is on is a contradiction only the author can settle, and the
				// narrower note is the later one: steering is injected broad scope first.
				const bySubject = (found[marker.key] ??= {});
				bySubject[marker.frameworkId] = { ...marker.fields };
			}
			let start = marker.index;
			let end = start + marker.raw.length;
			if (line[end] === ' ' || line[end] === '\t') end += 1;
			else if (start > cursor && (line[start - 1] === ' ' || line[start - 1] === '\t')) start -= 1;
			out += line.slice(cursor, start);
			cursor = end;
		}
		out += line.slice(cursor);
		if (out.trim() === '') continue;
		kept.push(out);
	}
	return { text: kept.join('\n'), found };
}

/**
 * Scan a prompt's steering notes.
 *
 * Generic over the note shape rather than importing the steering types: this layer has no
 * business knowing what a scope or a depth is, and the only field it touches is the text.
 *
 * A note stripped down to nothing is dropped from the list entirely. Steering never sends a
 * blank turn, and a note that was only ever a marker has said everything it had to say by
 * being read here.
 */
export function scanModifiers<T extends { text: string }>(
	notes: readonly T[] | undefined
): ModifierScan<T> {
	if (!notes?.length) return { modifiers: {}, notes: [] };

	const modifiers: Record<string, Record<string, Record<string, string>>> = {};
	const kept: T[] = [];
	for (const note of notes) {
		const { text, found } = stripModifiers(note.text);
		for (const [key, byFramework] of Object.entries(found)) {
			modifiers[key] = { ...(modifiers[key] ?? {}), ...byFramework };
		}
		if (text.trim() === '') continue;
		kept.push(text === note.text ? note : { ...note, text });
	}
	return { modifiers, notes: kept };
}
