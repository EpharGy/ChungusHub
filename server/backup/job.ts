/**
 * The snapshot job, as run inside a child process.
 *
 * It is a child rather than a worker thread because `bun build --compile` does not carry
 * worker entry points into the executable: a `new Worker(new URL(…))` that runs perfectly
 * from source dies with ModuleNotFound in every portable build, which is the only build
 * users have. Re-invoking THIS executable with a job variable set works in both, and it is
 * what `service.ts` does.
 *
 * A separate process rather than inline work because `bun:sqlite` is synchronous: a
 * `VACUUM INTO` on a 300 MB database blocks the event loop for the better part of a second,
 * and larger libraries for many seconds. Inline, every scheduled backup would stall token
 * streaming and flash the outage bar on every connected device.
 *
 * Reporting is newline-delimited JSON on stdout. Anything the process writes that is not a
 * line of that shape is treated as noise by the parent, so a stray console.log cannot
 * corrupt the protocol.
 */
import type { SnapshotKind, SnapshotManifest } from '../../shared/backups';
import { createSnapshot } from './snapshot';

export type JobMessage =
	| { t: 'progress'; phase: string; filesDone: number; filesTotal: number }
	| { t: 'done'; manifest: SnapshotManifest }
	| { t: 'error'; message: string };

/** The variable that turns this executable into a job runner instead of a server. */
export const JOB_ENV = 'CHUNGUS_BACKUP_JOB';

export interface JobSpec {
	kind: SnapshotKind;
	label: string | null;
}

function emit(message: JobMessage): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function runJobChild(): Promise<never> {
	let spec: JobSpec;
	try {
		spec = JSON.parse(process.env[JOB_ENV] ?? '') as JobSpec;
	} catch {
		emit({ t: 'error', message: `${JOB_ENV} did not contain a readable job.` });
		process.exit(1);
	}

	try {
		const manifest = await createSnapshot({
			kind: spec.kind,
			label: spec.label,
			onProgress: (p) => emit({ t: 'progress', ...p })
		});
		emit({ t: 'done', manifest });
		process.exit(0);
	} catch (error) {
		emit({ t: 'error', message: error instanceof Error ? error.message : String(error) });
		process.exit(1);
	}
}
