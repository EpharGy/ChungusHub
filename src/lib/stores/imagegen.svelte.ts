/**
 * The image engine: markers in, pictures on the turn.
 *
 * Shaped after the Sprites engine, which solves the same problem - a background call per
 * reply, whose result belongs to one message row and whose failure has to be visible
 * somewhere. What is different is that a picture takes a minute rather than a second, and
 * that a message can ask for several, so this store keeps per-marker state instead of
 * per-message state and does its work strictly in order.
 *
 * **The turn's own text is never rewritten.** The marker stays where the model put it and
 * the picture is filed against its index, which is what buys three things at once: no edit
 * stamp is spent (so no summary is invalidated), the model sees its own marker again next
 * turn and can hold a character's look across pictures with no interceptor anywhere, and a
 * reader who deletes the picture gets the marker back rather than a hole.
 *
 * Ownership follows the rest of the app: the row belongs to the chat store, so this writes
 * through the db and then asks for a refresh rather than patching a message in place.
 */

import { SvelteMap } from 'svelte/reactivity';

import { db } from '$lib/services/database';
import { chatStore } from '$lib/stores/chat.svelte';
import { toastStore } from '$lib/stores/toast.svelte';
import { readSetting, registerSettingsReload, writeSetting } from '$lib/services/syncedSetting';
import { generateImage, pingComfy } from '$lib/services/imagegenService';
import { DEFAULT_IMAGEGEN_SETTINGS, resolveImagegenSettings } from '$lib/imagegen/config';
import { findMarkers } from '$lib/imagegen/parse';
import { buildGenerateRequest, randomSeed, resolveEffective } from '$lib/imagegen/request';
import type {
	GeneratedImageMeta,
	ImagegenSettings,
	MarkerMatch,
	ParsedMarker,
	SeedToken
} from '$lib/imagegen/types';
import type { Message, MessageAttachment } from '$lib/types/chat';
import { findActivePath } from '$lib/utils/message-tree';

const SETTINGS_KEY = 'imagegen';

/** What a marker is doing right now. Anything with a picture already is simply not here. */
export type MarkerStatus = 'idle' | 'working' | 'error';

/** One marker, addressed. Message id and marker index, because a message can hold several
 *  and each of them succeeds or fails on its own. */
function slotKey(messageId: string, markerIndex: number): string {
	return `${messageId}:${markerIndex}`;
}

/** The picture filed against this marker, if one has been made. */
export function generatedFor(message: Message | null | undefined, markerIndex: number): MessageAttachment | null {
	if (!message?.attachments) return null;
	return message.attachments.find((a) => a.generated?.marker === markerIndex) ?? null;
}

/** The pictures the reader attached themselves: everything the engine did not make. Drawn in
 *  the attachment strip, where they always were. */
export function userAttachments(message: Message | null | undefined): MessageAttachment[] {
	return (message?.attachments ?? []).filter((a) => a.kind === 'image' && !a.generated);
}

class ImagegenStore {
	settings = $state<ImagegenSettings>(DEFAULT_IMAGEGEN_SETTINGS);
	loaded = $state(false);

	/** Markers with a call in flight. Keyed per marker, so one slow picture never makes the
	 *  others in the same message look busy. */
	private working = new SvelteMap<string, true>();
	/** The last failure per marker, kept until it is retried. This is the only place a
	 *  failure lives: it is deliberately NOT written to the row, because a picture that
	 *  failed is a marker with no picture, which is a state the text already describes. */
	private failures = new SvelteMap<string, string>();
	/** What the last reachability check found. Only the automatic path consults it; a reader
	 *  who clicks Generate is asking for an attempt whatever this says. */
	private offline = $state(false);
	/** Whether the current outage has already been reported. One toast per outage, not one
	 *  per turn: a GPU box asleep overnight would otherwise narrate every reply. */
	private offlineReported = false;

	async initialize(): Promise<void> {
		this.settings = resolveImagegenSettings(
			await readSetting<Partial<ImagegenSettings> | null>(SETTINGS_KEY, null)
		);
		this.loaded = true;
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		this.settings = resolveImagegenSettings(
			await readSetting<Partial<ImagegenSettings> | null>(SETTINGS_KEY, null)
		);
	}

	/** The one gate. Off means markers render as plain text and nothing is ever asked of
	 *  ComfyUI, while every picture already made stays exactly where it is. */
	get active(): boolean {
		return this.settings.enabled;
	}

	/** True while anything at all is generating: what the composer and a future status
	 *  indicator read to say the engine is busy. */
	get busy(): boolean {
		return this.working.size > 0;
	}

	statusFor(messageId: string, markerIndex: number): MarkerStatus {
		const key = slotKey(messageId, markerIndex);
		if (this.working.has(key)) return 'working';
		if (this.failures.has(key)) return 'error';
		return 'idle';
	}

	errorFor(messageId: string, markerIndex: number): string | null {
		return this.failures.get(slotKey(messageId, markerIndex)) ?? null;
	}

	/** Change one or more settings. Written whole, like every other synced setting. */
	update(patch: Partial<ImagegenSettings>): void {
		this.settings = resolveImagegenSettings({ ...this.settings, ...patch });
		writeSetting(SETTINGS_KEY, this.settings);
	}

	/** True when the last reachability check found nothing answering. Automatic generation is
	 *  skipped while this holds; the buttons on a marker ignore it. */
	get hostOffline(): boolean {
		return this.offline;
	}

	/**
	 * Generate every marker on a turn that has no picture yet, oldest first.
	 *
	 * Fire-and-forget and strictly sequential: ComfyUI runs one job at a time through one
	 * GPU, so three parallel requests only make the first picture arrive last. Called after a
	 * reply lands (when auto-generate is on) and by the Generate button on a marker.
	 *
	 * **One reachability check per turn, and the first failure ends it.** A host that is not
	 * there costs a connection timeout PER MARKER otherwise - the failure is recorded against
	 * one marker, so the next marker on the same turn has no record of its own and is asked
	 * anyway, and a reply carrying three markers spends three timeouts arriving nowhere. The
	 * check runs only once something is actually pending, so a turn with no markers to make
	 * still costs nothing at all.
	 */
	async ensureForMessage(messageId: string, opts: { manual?: boolean } = {}): Promise<void> {
		if (!this.active) return;
		if (!opts.manual && !this.settings.autoGenerate) return;

		const message = this.messageById(messageId);
		if (!message || message.role !== 'assistant') return;

		const pending = findMarkers(message.content).filter(
			(marker): marker is MarkerMatch & { result: ParsedMarker } => {
				if (marker.result.status !== 'ok') return false;
				if (generatedFor(message, marker.index)) return false;
				if (this.working.has(slotKey(messageId, marker.index))) return false;
				// A marker that failed is not retried on its own: a broken host would otherwise
				// be asked again by every subsequent reply.
				if (!opts.manual && this.failures.has(slotKey(messageId, marker.index))) return false;
				return true;
			}
		);
		if (!pending.length) return;

		if (!opts.manual && !(await this.hostAnswers())) return;

		for (const marker of pending) {
			// Re-read the row per marker rather than trusting the list this started with: a
			// picture takes a minute, which is long enough for the turn to have been edited or
			// deleted, or for another tab to have filed this very marker.
			const current = this.messageById(messageId);
			if (!current) return;
			if (generatedFor(current, marker.index)) continue;

			// The first failure ends the turn. Whatever stopped that picture - a host that went
			// away between the check and the call, a checkpoint that will not load - stops the
			// next one the same way, and the reader has already been told once.
			if (!(await this.generate(messageId, marker.index, marker.result))) return;
		}
	}

	/**
	 * Is ComfyUI there? Asked once per turn, before anything is generated.
	 *
	 * The ping carries its own five-second ceiling, against a connection timeout per marker,
	 * so the worst case for a sleeping GPU box drops from minutes to seconds. It is
	 * deliberately NOT recorded in `failures`: nothing here says a marker is broken, only
	 * that now was a bad time to ask, so the next turn asks again and the buttons on a marker
	 * keep working the moment the machine comes back.
	 */
	private async hostAnswers(): Promise<boolean> {
		const online = await pingComfy(this.settings.host);
		this.offline = !online;
		if (online) {
			this.offlineReported = false;
			return true;
		}
		if (!this.offlineReported) {
			this.offlineReported = true;
			toastStore.warning(
				`ComfyUI is not answering at ${this.settings.host}. Skipping image generation until it does.`
			);
		}
		return false;
	}

	/**
	 * Make one marker's picture, honouring its own seed rule.
	 *
	 * What the button on a marker does, as against {@link ensureForMessage}, which is the
	 * whole turn. A reader looking at one placeholder among several asked for that one.
	 */
	async generateOne(messageId: string, markerIndex: number): Promise<void> {
		if (!this.active) return;
		const message = this.messageById(messageId);
		if (!message) return;

		const marker = findMarkers(message.content).find((m) => m.index === markerIndex);
		if (!marker || marker.result.status !== 'ok') return;
		if (this.working.has(slotKey(messageId, markerIndex))) return;

		this.failures.delete(slotKey(messageId, markerIndex));
		await this.generate(messageId, markerIndex, marker.result);
	}

	/**
	 * Make this marker's picture again with a fresh seed.
	 *
	 * Always a new random seed and always past the seed lock: the reader clicked retry
	 * because they did not want THIS picture, and honouring a LOCK here would hand them the
	 * same one back.
	 */
	async retry(messageId: string, markerIndex: number): Promise<void> {
		if (!this.active) return;
		const message = this.messageById(messageId);
		if (!message) return;

		const marker = findMarkers(message.content).find((m) => m.index === markerIndex);
		if (!marker || marker.result.status !== 'ok') return;

		this.failures.delete(slotKey(messageId, markerIndex));
		await this.generate(messageId, markerIndex, marker.result, { seed: randomSeed() });
	}

	/** Drop a generated picture, leaving its marker to be generated again. The file itself is
	 *  left to the ordinary refcount sweep, which is what owns every other stored picture. */
	async forget(messageId: string, markerIndex: number): Promise<void> {
		const message = this.messageById(messageId);
		if (!message) return;

		const kept = (message.attachments ?? []).filter((a) => a.generated?.marker !== markerIndex);
		this.failures.delete(slotKey(messageId, markerIndex));
		await db.updateMessageAttachments(messageId, kept.length ? kept : null);
		await chatStore.refreshChat(message.chatId);
	}

	/** One picture, start to finish. Answers whether the call itself succeeded, which is what
	 *  lets a turn stop at its first failure instead of spending a timeout per marker. */
	private async generate(
		messageId: string,
		markerIndex: number,
		parsed: ParsedMarker,
		opts: { seed?: number } = {}
	): Promise<boolean> {
		const key = slotKey(messageId, markerIndex);
		const settings = this.settings;
		const effective = resolveEffective(parsed, settings);
		const seed = opts.seed ?? this.resolveSeed(effective.seedToken, messageId);

		this.working.set(key, true);
		try {
			const result = await generateImage(buildGenerateRequest(effective, seed, settings));

			// Re-read the row rather than trusting the copy this started with: a minute is long
			// enough for the reader to have edited the turn, retried a neighbouring marker, or
			// walked to another branch, and the attachment list is written whole.
			const current = this.messageById(messageId);
			// The picture was made, so the host is plainly fine; there is just no longer a row
			// to hang it on. Reported as a success for that reason - the turn's remaining
			// markers are gone with the row anyway, and the loop re-reads before each one.
			if (!current) return true;

			const meta: GeneratedImageMeta = {
				marker: markerIndex,
				prompt: parsed.prompt,
				seed,
				ar: effective.ar,
				shot: effective.shot,
				width: effective.resolution.width,
				height: effective.resolution.height,
				promptId: result.promptId,
				filename: result.filename,
				createdAt: Date.now(),
				repairMeta: parsed.repairMeta
			};

			const attachments = [
				...(current.attachments ?? []).filter((a) => a.generated?.marker !== markerIndex),
				{ kind: 'image', path: result.path, generated: meta } satisfies MessageAttachment
			];

			await db.updateMessageAttachments(messageId, attachments);
			await chatStore.refreshChat(current.chatId);
			this.failures.delete(key);
			// A picture just came back, so whatever the last check thought, the host is there.
			// This is how a manual retry brings automatic generation back with it.
			this.offline = false;
			this.offlineReported = false;
			return true;
		} catch (error) {
			// Loud once, in two places: the marker itself carries the reason and a retry, and a
			// toast says so for the reader who is not looking at that part of the transcript.
			const text = error instanceof Error ? error.message : String(error);
			this.failures.set(key, text);
			console.error('[imagegen] generation failed:', error);
			toastStore.failed('generate an image', error);
			return false;
		} finally {
			this.working.delete(key);
		}
	}

	/**
	 * A seed token becomes a number.
	 *
	 * `LOCK` means "whatever the last picture used", and the answer depends on the path being
	 * read: the story is a tree, so the seed is looked up by walking back from this turn
	 * through its own ancestors rather than through whatever was generated most recently.
	 * That is what makes a swipe reuse the look of the reply it replaced instead of the look
	 * of a branch the reader has left.
	 */
	private resolveSeed(token: SeedToken, messageId: string): number {
		if (typeof token === 'number') return Number.isFinite(token) ? Math.round(token) : randomSeed();
		if (token === 'RANDOM') return randomSeed();

		// The turn's own ancestry, walked from the row itself rather than sliced out of the
		// open path. A turn the reader has navigated away from is not on that path at all,
		// and the path's tail is then a different story whose look this picture has no
		// business inheriting.
		const ancestors = findActivePath(chatStore.currentChatState?.allMessages ?? [], messageId);

		for (let i = ancestors.length - 1; i >= 0; i--) {
			const generated = (ancestors[i].attachments ?? [])
				.map((a) => a.generated)
				.filter((meta): meta is GeneratedImageMeta => Boolean(meta))
				.sort((a, b) => b.marker - a.marker);
			const newest = generated[0];
			if (newest && Number.isFinite(newest.seed)) return newest.seed;
		}

		// Nothing to lock onto yet: the first picture in a story asks for LOCK and means
		// "the same as before", and before is nothing.
		return randomSeed();
	}

	/** The row as the chat store currently holds it. Every read goes through here so nothing
	 *  in this store ever works from a message it captured a minute ago. */
	private messageById(messageId: string): Message | null {
		const state = chatStore.currentChatState;
		if (!state) return null;
		return state.allMessages.find((m) => m.id === messageId) ?? null;
	}
}

export const imagegenStore = new ImagegenStore();
