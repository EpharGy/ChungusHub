/**
 * The one readable line the assistant panel shows while a tool call's arguments are
 * still streaming (see the `assistant-tool-progress` event in loop.ts).
 *
 * Providers report the FULL accumulated arguments on every delta, so this always runs
 * over a complete prefix (never a tail), which is what lets the scan know whether a
 * string sits in key or value position. The fragment is normally UNTERMINATED (the model
 * is mid-write), so nothing here may go through `JSON.parse`.
 *
 * It picks the LONGEST string value in the fragment. Tool arguments mix prose with ids,
 * enums and field names; the prose is the only part worth watching, and once a call has
 * written 3000 characters of it, a 12-character trailing argument must not displace it in
 * the final frames, which is what "whatever is being written right now" would do.
 *
 * Display only: a fragment this cannot make sense of yields an empty line and the panel
 * shows the call's name alone. Whether a call actually RUNS is decided elsewhere, by a
 * real parse of the finished arguments (`parseable` in loop.ts), which refuses loudly.
 */

/** How much of the picked value rides the wire: one clipped line in a narrow panel. */
const PROGRESS_TEXT_CHARS = 200;
/** Under this a value is an id, an enum or a field name: nothing worth watching stream. */
const PROGRESS_TEXT_MIN = 40;

/** JSON's two-character escapes, minus the ones that decode to themselves. */
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/** Renders a partial tool-call arguments string as one line of text, or '' when the call
 *  has nothing substantial to show yet (short scalar arguments, or no arguments at all). */
export function toolProgressText(rawArguments: string): string {
	// One line, so runs of whitespace (a paragraph break inside a description) collapse
	// instead of pushing the visible text off the row.
	const flat = longestStringValue(rawArguments).replace(/\s+/g, ' ').trim();
	if (flat.length < PROGRESS_TEXT_MIN) return '';
	// The leading marker is honest about the text having a head the panel never showed.
	return flat.length > PROGRESS_TEXT_CHARS ? `…${flat.slice(-PROGRESS_TEXT_CHARS)}` : flat;
}

/**
 * Scans a (possibly unterminated) JSON fragment for its longest string VALUE, decoding
 * escapes as it goes. Keys are read only to keep track of which position the next string
 * sits in: an argument's NAME is never the text the model is writing.
 */
function longestStringValue(raw: string): string {
	let best = '';
	/** Open containers, so a string can be told to be a key only inside an object. */
	const stack: string[] = [];
	let expectKey = false;
	let i = 0;
	while (i < raw.length) {
		const c = raw[i];
		if (c === '"') {
			const read = readString(raw, i);
			if (!expectKey && read.text.length > best.length) best = read.text;
			i = read.end;
			continue;
		}
		i += 1;
		if (c === '{') {
			stack.push('{');
			expectKey = true;
		} else if (c === '[') {
			stack.push('[');
			expectKey = false;
		} else if (c === '}' || c === ']') {
			stack.pop();
			expectKey = false;
		} else if (c === ',') {
			expectKey = stack[stack.length - 1] === '{';
		} else if (c === ':') {
			expectKey = false;
		}
	}
	return best;
}

/**
 * Reads one JSON string starting at its opening quote. A string the stream cut short
 * (unterminated, or split mid-escape) returns what exists so far and ends at the
 * fragment's end, which is the normal case while the model is still writing it.
 */
function readString(raw: string, start: number): { text: string; end: number } {
	let out = '';
	let i = start + 1;
	while (i < raw.length) {
		const c = raw[i];
		if (c === '"') return { text: out, end: i + 1 };
		if (c !== '\\') {
			out += c;
			i += 1;
			continue;
		}
		const esc = raw[i + 1];
		if (esc === undefined) break;
		if (esc === 'u') {
			const hex = raw.slice(i + 2, i + 6);
			if (hex.length < 4) break;
			const code = Number.parseInt(hex, 16);
			if (!Number.isNaN(code)) out += String.fromCharCode(code);
			i += 6;
			continue;
		}
		out += ESCAPES[esc] ?? esc;
		i += 2;
	}
	return { text: out, end: raw.length };
}
