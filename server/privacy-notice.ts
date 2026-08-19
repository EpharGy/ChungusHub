/**
 * The two files that mark a folder as private: a notice a person reads, and a `.gitignore`
 * that stops a machine. Both the data dir and the backup store hold the same secrets (API
 * keys, the password hash, every chat), and both are folders people move around by hand.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PRIVACY_NOTICE_FILE = 'DO-NOT-SHARE-THIS-FOLDER.txt';

const WHAT_IS_INSIDE = `  - API keys for every provider you have set up
  - Your app password hash and active login sessions
  - Every chat, character, persona, lorebook and preset you own
  - Every image you have uploaded

Anyone who gets a copy can spend your API credit and read everything you
have ever written here. Emailing it, dropping it in a cloud drive and
attaching it to a bug report all count as sharing.

Moving to another machine? Copy the whole folder over a channel you trust,
then delete the copy you sent.

Reporting a bug? Send the log output, never this folder.
`;

const NOTICES = {
	data: `DO NOT SHARE THIS FOLDER

This folder is your ChungusHub account. It holds:

${WHAT_IS_INSIDE}`,
	backups: `DO NOT SHARE THIS FOLDER

Each folder in here is a full copy of your ChungusHub data dir, with
everything listed below inside it:

${WHAT_IS_INSIDE}`
} as const;

// `*` and nothing else: whatever repo this folder ends up inside, by a drag or by someone
// running `git init` where the app lives, nothing in it is ever staged.
const GITIGNORE = `# This folder is private. Nothing in it belongs in a repository.
*
`;

export type PrivateFolderKind = keyof typeof NOTICES;

/**
 * Write both markers into `dir` if they are not already there. Never overwrites: a reader
 * who edited the notice keeps their edit, and one who deleted it gets it back at the next
 * boot, which is the right way round for a warning.
 */
export function ensurePrivacyMarkers(dir: string, kind: PrivateFolderKind): void {
	const notice = join(dir, PRIVACY_NOTICE_FILE);
	if (!existsSync(notice)) writeFileSync(notice, NOTICES[kind]);
	const gitignore = join(dir, '.gitignore');
	if (!existsSync(gitignore)) writeFileSync(gitignore, GITIGNORE);
}
