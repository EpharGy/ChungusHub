/**
 * The repairs a freshly opened database needs before anything is allowed to read it.
 *
 * They run at every boot, and that single call covers the boot that follows a restore too:
 * a restored database was written by a process that is long gone, so its rows carry exactly
 * the marks a crash leaves (an assistant turn still marked running, a logged prompt still
 * shown in flight), with nothing left alive to settle either.
 */
import { serverDb } from './db';
import * as promptLog from './promptLog';
import { ensureDefaultPresets } from './files';
import { ensureDefaultCharacters } from './default-characters';

export function runBootSweeps(): void {
	// An assistant turn writes its row as it runs, so a process that died mid-turn leaves one
	// marked running. Nothing can resume it: mark it interrupted, which keeps the steps it did
	// finish in the transcript and keeps it out of the retry path (a retry would repeat every
	// mutation the turn already committed).
	const interruptedTurns = serverDb.markInterruptedAssistantTurns();
	if (interruptedTurns > 0) {
		console.log(`[assistant] ${interruptedTurns} turn(s) were interrupted; marked as such.`);
	}
	// Same reasoning for the debug log: a captured request whose result never arrived stays
	// 'pending' on disk, and the panel would show it as in-flight forever, indistinguishable
	// from one that is genuinely still running.
	const settledPrompts = promptLog.settleInterrupted();
	if (settledPrompts > 0) {
		console.log(`[debug] ${settledPrompts} logged prompt(s) never returned; settled as errors.`);
	}
	// Reap chat-image uploads that never got a referencing row (abandoned composers):
	// nothing else can ever reach them. Age-guarded inside.
	serverDb.sweepAbandonedChatImages();
	// The same reap for attached files: bytes whose row is gone (a session deleted while the
	// server was down, a crash between the write and the insert) are reachable by nothing else.
	serverDb.sweepAbandonedAssistantFiles();
	// The generated-image cache, if the reader gave it a budget. Unlike the two above this
	// reaps pictures that ARE still referenced, so it is guarded by that setting and by a
	// one-hour grace on each picture's own age. It belongs here because every other trigger
	// is a picture landing: a session that ended over budget would otherwise stay there
	// until the reader next generated something.
	serverDb.sweepGeneratedImageCacheToBudget();
	// Also reseeds after a restore: a snapshot can predate a preset this build ships.
	ensureDefaultPresets();
	// The example characters, which are the opposite: seeded once per id and never again, so a
	// deleted one stays deleted (server/default-characters.ts).
	ensureDefaultCharacters();
}
