/**
 * Tests for the markdown/HTML seam. Run with `bun test`.
 *
 * Every assertion here is about a reply that arrived looking wrong on screen: a panel body
 * printed as one run-on line of literal dashes, or a hand-written panel with twice the gaps
 * its author wrote. The transform is pure text in, text out. What marked then makes of it
 * is marked's business.
 */

import { describe, expect, test } from 'bun:test';

import { prepareModelMarkup } from './model-markup';

describe('panel bodies', () => {
	test('a body on the line after the summary is separated from it', () => {
		expect(prepareModelMarkup('<details><summary>Scene</summary>\n- Env: cold\n</details>')).toBe(
			'<details><summary>Scene</summary>\n\n- Env: cold\n\n</details>'
		);
	});

	test('the opening tag on its own line stays with the summary', () => {
		expect(prepareModelMarkup('<details>\n<summary>State</summary>\n- a\n</details>')).toBe(
			'<details>\n<summary>State</summary>\n\n- a\n\n</details>'
		);
	});

	test('nesting is handled by treating every tag line on its own', () => {
		const source = [
			'<details><summary>Outer</summary>',
			'<details><summary>Inner</summary>',
			'- a',
			'</details>',
			'</details>'
		].join('\n');
		expect(prepareModelMarkup(source)).toBe(
			[
				'<details><summary>Outer</summary>',
				'',
				'<details><summary>Inner</summary>',
				'',
				'- a',
				'',
				'</details>',
				'',
				'</details>'
			].join('\n')
		);
	});

	test("indented tags are still tags, up to markdown's own three spaces", () => {
		expect(prepareModelMarkup('  <details><summary>S</summary>\n  - a\n  </details>')).toBe(
			'  <details><summary>S</summary>\n\n  - a\n\n  </details>'
		);
	});

	test('a blank line the model already wrote is not doubled', () => {
		const source = '<details><summary>S</summary>\n\n- a\n\n</details>';
		expect(prepareModelMarkup(source)).toBe(source);
	});

	test('an empty panel gets one separator, not two', () => {
		expect(prepareModelMarkup('<details><summary>S</summary>\n</details>')).toBe(
			'<details><summary>S</summary>\n\n</details>'
		);
	});

	test('a whole panel on one line is left alone', () => {
		const source = '<details><summary>S</summary>body</details>';
		expect(prepareModelMarkup(source)).toBe(source);
	});

	test('prose with no panel in it passes through untouched', () => {
		const source = 'She turned.\n\n- a list\n- of things\n\nAnd left.';
		expect(prepareModelMarkup(source)).toBe(source);
	});
});

describe('trailing line breaks', () => {
	test('a break at the end of a line goes, because the line ending says it', () => {
		expect(prepareModelMarkup('first<br>\nsecond<br/>\nthird')).toBe('first\nsecond\nthird');
	});

	// Three breaks where the author drew two, if the lone one were spared. Emptying the line
	// leaves the blank one they meant, which markdown reads as a paragraph break.
	test('a break alone on its own line empties the line rather than doubling the gap', () => {
		expect(prepareModelMarkup('post one<br>\n<br>\npost two')).toBe('post one\n\npost two');
	});

	test('a break in the middle of a line is untouched', () => {
		expect(prepareModelMarkup('<b>A:</b> 1<br><b>B:</b> 2')).toBe('<b>A:</b> 1<br><b>B:</b> 2');
	});

	test('trailing whitespace after the break does not save it', () => {
		expect(prepareModelMarkup('line <BR />   \nnext')).toBe('line \nnext');
	});
});

describe('fenced code', () => {
	test('a panel quoted inside a fence is writing about markup, not markup', () => {
		const source = ['```html', '<details><summary>S</summary>', '- not a list<br>', '</details>', '```'].join(
			'\n'
		);
		expect(prepareModelMarkup(source)).toBe(source);
	});

	test('the transform resumes after the fence closes', () => {
		const source = ['```', '<details><summary>A</summary>', '```', '<details><summary>B</summary>', '- a'].join(
			'\n'
		);
		expect(prepareModelMarkup(source)).toBe(
			['```', '<details><summary>A</summary>', '```', '<details><summary>B</summary>', '', '- a'].join('\n')
		);
	});

	test('a tilde fence does not close a backtick one', () => {
		const source = ['```', '~~~', '<details><summary>S</summary>', '- a', '```', ''].join('\n');
		expect(prepareModelMarkup(source)).toBe(source);
	});
});
