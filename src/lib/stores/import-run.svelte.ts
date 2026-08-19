/**
 * The SillyTavern folder import, held outside the page that starts it.
 *
 * An import walks a whole library and takes as long as that takes, so the reader closes
 * Settings and goes back to a chat while it runs. The run's state therefore cannot live in
 * `settings/ImportPage.svelte`: closing the panel unmounts that card, and the progress goes off
 * the screen and the summary lands nowhere while the import itself carries on writing
 * characters, chats and pictures. Held here, `layout/ImportBar` reports it for as long as it
 * runs and the page picks the summary back up on its next mount.
 *
 * Reading the pick is a step of its own (`pending`), because an import is hundreds of
 * irreversible writes and this app has no undo: the counts belong on screen while the answer
 * is still no.
 *
 * **A run can be stopped and there is no resuming it**, by decision. What continues a stopped
 * import is running the same folder again: every file that landed is claimed in the import
 * ledger (architecture/server-core.md), so the next scan finds only what is left. That is the
 * same mechanism that keeps a second run from duplicating a first one, and it survives a stop,
 * a reload and a server that died mid-way, none of which a stored resume position would.
 *
 * The page draws its own summary and its own failure line, so neither says anything through the
 * toast stack: whoever is looking at that card is looking straight at the thing that did the
 * work. The standing row carries the running condition, and the finish toast fires only for a
 * reader who is somewhere else.
 *
 * Runtime state, written nowhere. The run is one page's async call, so a reload ends it, and
 * anything persisted here would outlive the thing it describes.
 */
import {
	importSillyTavernFolder,
	type ImportProgress,
	type ImportReport
} from '$lib/services/sillyTavernFolderImport';
import {
	countFiles,
	scanSillyTavernFolder,
	withoutImported,
	type FolderScan,
	type ImportedSource
} from '$lib/services/sillyTavernFolderScan';
import { db } from '$lib/services/database';
import { isReachable, onReachabilityChange } from '$lib/services/transport';
import { failureText, toastStore } from './toast.svelte';

/** A pick that was not a profile folder. It names what to pick instead, since "not found"
 *  without a way forward is where an import stops for good. */
const NOT_FOUND =
	'No SillyTavern data in that folder. Pick your profile folder, usually "data/default-user".';

/** Why a run ended early. Both are ordinary endings rather than failures, and each is said in
 *  its own words: one is a decision, the other is an outage the reader has to fix first. */
export type StopReason = 'you' | 'connection';

class ImportRunStore {
	/** The whole pick, waiting for the reader to confirm it. */
	pending = $state<FolderScan | null>(null);
	/** What the ledger already holds, read when the folder was picked and handed to the run so
	 *  it can bind this folder's chats to cards an earlier run brought over. */
	private claims = $state<ImportedSource[]>([]);
	private known = $derived(new Set(this.claims.map((c) => c.key)));
	/** Bring the already-imported files over a second time. Off by default and deliberately
	 *  reachable even when everything in the folder is known, since re-importing something the
	 *  reader has since deleted is the one thing skipping would otherwise make impossible. */
	bringKnownAgain = $state(false);

	running = $state(false);
	progress = $state<ImportProgress | null>(null);
	report = $state<ImportReport | null>(null);
	error = $state<string | null>(null);
	/** Set when the last run ended early, cleared when the next one starts. */
	stoppedBy = $state<StopReason | null>(null);

	private controller: AbortController | null = null;

	/** The pick minus what the ledger already holds. Stands on its own rather than living inside
	 *  `plan`, so the count below can be measured against it whatever the checkbox says. */
	private fresh = $derived(this.pending ? withoutImported(this.pending, this.known) : null);

	/** What Import would actually write: the pick minus what the ledger already holds, unless
	 *  the reader asked for all of it. */
	plan = $derived.by(() => {
		if (!this.pending) return null;
		return this.bringKnownAgain ? this.pending : this.fresh;
	});

	/** How many of the picked files this folder has sent before. Measured against the pick and
	 *  never against the plan: off the plan it collapses to zero the moment the reader ticks the
	 *  box, which erases the number the box is asking about and takes the row itself off screen
	 *  with it, leaving no way to untick. */
	alreadyImported = $derived(
		this.pending && this.fresh ? countFiles(this.pending) - countFiles(this.fresh) : 0
	);

	/** How many Import pages are on screen. Not reactive: it is read once, at the end of a run. */
	private onScreen = 0;

	/** Called by the Import page for its lifetime, so the finish toast can stand down while the
	 *  summary it would repeat is already being drawn. */
	watch(): () => void {
		this.onScreen++;
		return () => {
			this.onScreen--;
		};
	}

	/** Read a picked folder and hold what was found, against what has come over before. */
	async scan(files: File[]): Promise<void> {
		this.report = null;
		this.error = null;
		this.stoppedBy = null;
		this.bringKnownAgain = false;
		this.pending = null;

		const found = scanSillyTavernFolder(files);
		if (!found) {
			this.error = NOT_FOUND;
			return;
		}
		// The card is published only once the ledger has answered, and both are set together:
		// shown a moment earlier it would state the whole folder as the plan, and an Import
		// pressed in that moment writes every duplicate the ledger exists to prevent.
		try {
			this.claims = await db.getImportedSources();
		} catch (e) {
			// Without the ledger every file reads as new. The pick is dropped rather than offered
			// under a count that would be a lie.
			this.error = failureText('check what has already been imported', e);
			return;
		}
		this.pending = found;
	}

	discard(): void {
		this.pending = null;
	}

	/** End the run at the next item boundary. Never inside one: half a character, its card
	 *  written and its sprites not, is worse than one more character. */
	stop(reason: StopReason = 'you'): void {
		if (!this.running) return;
		this.stoppedBy = reason;
		this.controller?.abort();
	}

	async start(): Promise<void> {
		const plan = this.plan;
		if (!plan) throw new Error('Nothing scanned to import');
		this.pending = null;
		this.running = true;
		this.report = null;
		this.error = null;
		this.progress = null;
		this.stoppedBy = null;
		this.controller = new AbortController();

		// An outage ends the run rather than grinding the rest of the folder into a list of
		// identical failures: every write fails while the server is gone, and what has landed
		// is already claimed, so the way to finish is to run the folder again once it is back.
		const watchConnection = onReachabilityChange((reachable) => {
			if (!reachable) this.stop('connection');
		});
		if (!isReachable()) this.stop('connection');

		try {
			const report = await importSillyTavernFolder(plan, {
				onProgress: (p) => (this.progress = p),
				signal: this.controller.signal,
				claims: this.claims
			});
			this.report = report;
			if (this.onScreen === 0) this.announce(report);
		} catch (e) {
			this.error = failureText('import that folder', e);
		} finally {
			watchConnection();
			this.controller = null;
			this.running = false;
			this.progress = null;
		}
	}

	/** Work that landed off-screen, which is the toast channel's own case. The counts are the
	 *  headline; the per-category summary is waiting on the page. */
	private announce(report: ImportReport): void {
		const groups = [
			report.characters,
			report.sprites,
			report.worlds,
			report.backgrounds,
			report.personas,
			report.chats
		];
		const imported = groups.reduce((sum, g) => sum + g.imported, 0);
		const failed = groups.reduce((sum, g) => sum + g.failed.length, 0);
		if (this.stoppedBy === 'connection') {
			toastStore.warning(`SillyTavern import stopped, the server went away. ${imported} items came over.`);
			return;
		}
		if (this.stoppedBy === 'you') {
			toastStore.info(`SillyTavern import stopped, ${imported} items came over`);
			return;
		}
		if (failed > 0) {
			toastStore.warning(`Imported ${imported} items from SillyTavern, ${failed} failed`);
			return;
		}
		toastStore.success(`Imported ${imported} items from SillyTavern`);
	}
}

export const importRun = new ImportRunStore();
