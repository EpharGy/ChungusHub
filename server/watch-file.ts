/**
 * Watch one state file under the data directory and call back once its writes settle.
 *
 * Editing these files by hand is how a machine with no browser on it is configured, so
 * they are applied while the server runs rather than at boot alone.
 *
 * **The directory is watched, not the file.** Every writer here replaces its file by
 * rename (write to a temp, rename over the real one), and a watch bound to the file it
 * opened with stops hearing about the one that took its place. Saving in an editor is
 * several writes besides, so events are collapsed into one call after they stop arriving.
 *
 * The callback is told a write happened, never what changed: the server writes these
 * files itself, so each caller has to re-read and decide whether anything it cares about
 * actually moved. Without that check a server that rewrites a file on a timer would read
 * its own writes as somebody's edit.
 */
import { watch } from 'node:fs';
import { basename, dirname } from 'node:path';

/** Long enough to swallow an editor's multi-step save, short enough to feel immediate. */
const SETTLE_MS = 150;

export function watchDataFile(path: string, onSettled: () => void): void {
	const name = basename(path);
	let timer: ReturnType<typeof setTimeout> | null = null;
	watch(dirname(path), (_event, filename) => {
		if (filename !== name) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			onSettled();
		}, SETTLE_MS);
	});
}
