/**
 * The seam between the HTML a model writes and the markdown around it.
 *
 * A reply is not pure markdown. Presets have the model print folding panels of story state
 * as literal `<details>`/`<summary>`, and inside those panels it goes on writing the same
 * markdown it writes everywhere else. Markdown's own rules do not expect that mixture, so
 * the source is corrected before it is parsed.
 *
 * Kept out of `markdown.ts` and pure so it can be tested without a DOM, exactly like
 * {@link ./inline-decoration.ts}.
 */

/**
 * Prepare a reply's raw text for the markdown parser: give a folding panel's body back to
 * markdown, and drop a line break that says what the line ending already said. Two
 * corrections, one walk over the lines, because they are two halves of the same seam.
 *
 * **The panel body.** CommonMark reads `<details>` as the opening of a raw-HTML block that
 * runs to the next blank line, and a model writes its panels the way anyone would: the body
 * on the line straight after `</summary>`. So the body lands on the page as one run-on line
 * of literal text, list dashes and all, which is exactly the shape story-state panels are
 * written in. A blank line is what closes that raw block, so one is inserted after the
 * `</summary>` line and before the `</details>` line. The tags stay their own HTML blocks,
 * and everything between them is parsed like the prose outside the panel, at any nesting
 * depth, since each tag line is treated on its own.
 *
 * **The trailing break.** A `<br>` at the end of a line is what the line ending already
 * means once the body is markdown, and keeping both doubles every gap in a panel written in
 * hand-rolled HTML, which is most of them, and all of the imported ones. Dropping it
 * leaves exactly one break. It applies with no exception, including to a `<br>` alone on
 * its own line: that line then reads as the blank one its author was drawing, which markdown
 * turns into a paragraph break. Sparing it instead would land three breaks where two were
 * written, and leave the rule with a case to explain. A `<br>` mid-line is untouched: that
 * one is doing work nothing else is doing.
 *
 * Fenced code is skipped whole: a panel quoted inside a fence is writing *about* markup.
 * An indented code block is not tracked, and deliberately so: the tracking needs the
 * paragraph-interruption rules to be right, and the only cost of leaving it out is a stray
 * blank line inside a four-space-indented code sample that happens to contain a panel tag.
 */
export function prepareModelMarkup(source: string): string {
	const lines = source.split('\n');
	const out: string[] = [];
	/** The fence character currently holding a code block open, or null outside one. */
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
		if (fenceMark) {
			if (fence === null) fence = fenceMark[1][0];
			else if (fenceMark[1][0] === fence) fence = null;
			out.push(lines[i]);
			continue;
		}
		if (fence !== null) {
			out.push(lines[i]);
			continue;
		}

		const line = lines[i].replace(/<br\s*\/?>[^\S\n]*$/i, '');
		if (/^\s{0,3}<\/details>/i.test(line) && out.length > 0 && out[out.length - 1].trim() !== '') {
			out.push('');
		}
		out.push(line);
		const next = lines[i + 1];
		if (/<\/summary>[^\S\n]*$/i.test(line) && next !== undefined && next.trim() !== '') {
			out.push('');
		}
	}

	return out.join('\n');
}
