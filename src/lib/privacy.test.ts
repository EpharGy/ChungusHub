/**
 * The privacy contract: no tracked file names a real person from the author's stories.
 *
 * This exists because the rule "use generic data in fixtures" was broken twice, both times by
 * someone who knew the rule and was concentrating on something else. A rule nothing enforces
 * is a rule that holds until the moment it matters. This turns it into a failing test, and
 * because the deploy rebuild gates on `bun test`, an artifact carrying those names cannot be
 * built, let alone pushed.
 *
 * **The list lives outside the repository**, at `.private-names` in the working directory, one
 * name per line. Putting the names IN the repo to keep them out of the repo would be its own
 * joke. It is listed in `.git/info/exclude` rather than `.gitignore` for the same reason the
 * list is not committed: `.gitignore` is upstream's file, and an entry there would name the
 * mechanism to everyone who reads it.
 *
 * A missing list SKIPS rather than fails. Every checkout that is not the author's has no list
 * and no need of one, and a test that failed on a fresh clone would be deleted within a day.
 *
 * **Failures never echo the matched text.** A test that printed the name it found would move
 * the leak into the CI log, which is usually more public than the file.
 *
 * The sibling check is `.git/hooks/pre-push`, which reads the same list plus
 * `.private-topics`, and refuses the push itself. Two checks because they fail at different
 * moments: this one when an artifact is built, that one when anything reaches a remote.
 */

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const LIST = join(ROOT, '.private-names');

/** Letters, digits, spaces, apostrophes and hyphens. A name outside that is refused rather
 *  than escaped: the list is names, and anything else in it is a mistake worth seeing. */
const PLAIN_NAME = /^[\p{L}\p{N} '-]+$/u;

/** One name per line; `#` comments and blanks ignored. */
function privateNames(): string[] {
	if (!existsSync(LIST)) return [];
	return readFileSync(LIST, 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'));
}

describe('privacy contract', () => {
	test('the list itself is never tracked', () => {
		// If this ever fails, a list has been committed and the names are in the history.
		const tracked = execFileSync('git', ['ls-files', '--', '.private-names', '.private-topics'], {
			cwd: ROOT,
			encoding: 'utf8'
		}).trim();
		expect(tracked, 'a private list has been committed').toBe('');
	});

	test('every entry in the list is a plain name, so none needs escaping', () => {
		for (const name of privateNames()) {
			expect(PLAIN_NAME.test(name), 'a private-names entry is not a plain name').toBe(true);
		}
	});

	test('no tracked file names a real person', () => {
		const names = privateNames().filter((n) => PLAIN_NAME.test(n));
		if (names.length === 0) return; // No list here, nothing to enforce. See the header.

		const pattern = new RegExp(String.raw`\b(` + names.join('|') + String.raw`)\b`, 'iu');
		const files = execFileSync('git', ['ls-files', '-z'], {
			cwd: ROOT,
			encoding: 'utf8',
			maxBuffer: 64e6
		})
			.split('\0')
			.filter(Boolean);
		expect(files.length, 'git listed no files, so the scan is stale').toBeGreaterThan(100);

		// Locations only. Never the matched text: see the header.
		const offenders: string[] = [];
		for (const file of files) {
			const bytes = readFileSync(join(ROOT, file));
			if (bytes.includes(0)) continue; // Binary.
			const text = bytes.toString('utf8');
			if (!pattern.test(text)) continue;
			text.split('\n').forEach((line, i) => {
				if (pattern.test(line)) offenders.push(`${file}:${i + 1}`);
			});
		}
		expect(offenders, 'tracked files name a real person; use invented names').toEqual([]);
	});
});
