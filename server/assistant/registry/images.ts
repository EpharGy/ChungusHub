/**
 * Character/persona images: the look tool, the entry-art write, and the availability line
 * every entry read carries.
 *
 * Two invariants run through all of it. **A path never comes from the model**: a reference
 * names the user's own uploads or an entry's stored art, and the file behind it is always read
 * out of a database row. **Which entry a reference resolves against is an id argument**
 * (`sourceId`), never something packed into the reference itself, so copying art between two
 * entries is the same act as rearranging it within one.
 */
import { serverDb } from '../../db';
import { copyImage } from '../../files';
import { loadImage } from '../../llm/media';
import type { AssistantContext } from '../types';
import type { Capability } from './types';
import type { RawLibraryEntry } from '../rows';
import { stampState } from '../freshness';
import { ToolError, str, ok } from './util';

/** How many images a no-selection view attaches (portrait + newest gallery). */
const DEFAULT_VIEW_IMAGES = 5;
/** Hard cap per view call: every image costs context on every following request. */
const MAX_VIEW_IMAGES = 10;

/** A character/persona entry with its image set, or a loud error. `field` names which argument
 *  was wrong, so a dangling source is not reported as a dangling target. */
function loadImageEntry(id: string, field = 'id'): RawLibraryEntry {
	const raw = serverDb.getLibraryEntry(str(id).trim()) as RawLibraryEntry | null;
	if (!raw || (raw.type !== 'character' && raw.type !== 'persona')) {
		throw new ToolError(`No character or persona with ${field} "${str(id)}". Use find_entities to locate the right id.`);
	}
	return raw;
}

// ===== reading: what art an entry owns, and the portrait riding along =====

/** What art an entry owns. Reported on every character/persona read, gated by nothing. */
export interface EntryArt {
	portrait: boolean;
	gallery: number;
	/** Only about the portrait that was (or could not be) attached alongside the read. */
	note?: string;
}

/** The gate both look paths ask: the Images family governs SENDING bytes to the model, and a
 *  model with no eyes could not receive them anyway. Knowing what art exists asks neither. */
function canSeeImages(ctx: AssistantContext): boolean {
	return ctx.permissions.groups.has('images') && !!ctx.sendImages;
}

/** One entry's portrait, ready to attach, or the reason it cannot be. A broken file never fails
 *  the read that carried it; the injection would otherwise sink the whole next request. */
function attachablePortrait(raw: RawLibraryEntry): { path?: string; problem?: string } {
	const portrait = raw.identity.imageUrl;
	if (!portrait) return {};
	try {
		loadImage(portrait);
		return { path: portrait };
	} catch (e) {
		return { problem: `${raw.identity.name}: ${e instanceof Error ? e.message : String(e)}` };
	}
}

/** The one sentence a read says about the portraits riding along with it. Shared, so the
 *  single-entry read and the cast read cannot word the same fact two ways. */
function attachNote(attached: number, problems: string[]): string | undefined {
	const parts: string[] = [];
	if (attached) parts.push('Portrait attached in the next message.');
	if (problems.length) parts.push(`Portrait could not be attached: ${problems.join('; ')}.`);
	return parts.length ? parts.join(' ') : undefined;
}

/**
 * Portraits to auto-attach to a read covering SEVERAL entries (a chat's cast): reading them
 * then also SHOWS them, no separate view call.
 */
export function portraitAttachment(entryIds: (string | null | undefined)[], ctx: AssistantContext): { paths: string[]; note?: string } {
	if (!canSeeImages(ctx)) return { paths: [] };
	const paths: string[] = [];
	const problems: string[] = [];
	for (const id of entryIds) {
		if (!id) continue;
		const raw = serverDb.getLibraryEntry(id) as RawLibraryEntry | null;
		if (!raw) continue;
		const { path, problem } = attachablePortrait(raw);
		if (path) paths.push(path);
		if (problem) problems.push(problem);
	}
	const note = attachNote(paths.length, problems);
	return { paths, ...(note ? { note } : {}) };
}

/**
 * The image half of one character/persona read, in a single pass over the row.
 *
 * `images` is unconditional, and that is the point: knowing an entry HAS a portrait and how
 * many gallery images it owns costs no bytes and needs no vision model, yet it is what makes
 * that art nameable as a source afterwards. A read that stayed silent left the model unable to
 * use pictures the user can see in the library.
 *
 * The portrait itself rides along only when the Images family is on and the model can receive
 * it, the same consent-and-cost gate every other look pays.
 */
export function readEntryImages(entryId: string, ctx: AssistantContext): { images: EntryArt; paths: string[] } | null {
	const raw = serverDb.getLibraryEntry(entryId) as RawLibraryEntry | null;
	if (!raw || (raw.type !== 'character' && raw.type !== 'persona')) return null;
	const images: EntryArt = { portrait: !!raw.identity.imageUrl, gallery: raw.identity.gallery?.length ?? 0 };
	if (!canSeeImages(ctx)) return { images, paths: [] };
	const { path, problem } = attachablePortrait(raw);
	const note = attachNote(path ? 1 : 0, problem ? [problem] : []);
	return { images: note ? { ...images, note } : images, paths: path ? [path] : [] };
}

export const viewCharacterImages: Capability = {
	name: 'view_character_images',
	summary: `Look at images of a character or persona. They arrive as attachments in the next message so you can actually SEE them. Max ${MAX_VIEW_IMAGES} per call, and every image costs context: request only what the task needs. Requires a vision-capable assistant model.`,
	risk: 'read',
	params: [
		{ name: 'id', type: 'string', describe: 'Character or persona id.', required: true },
		{ name: 'images', type: 'string', describe: `Comma-separated selection: "portrait" and/or 1-based gallery numbers, oldest first (e.g. "portrait, 1, 2"). Omit for the default set: portrait + newest gallery images (${DEFAULT_VIEW_IMAGES} total).` }
	],
	run(args, ctx) {
		if (!ctx.sendImages) {
			throw new ToolError('The current assistant model cannot receive images. Pick a vision-capable assistant model in Settings → Connection, or answer from the text fields instead.');
		}
		const entry = loadImageEntry(str(args.id));
		const gallery = entry.identity.gallery ?? [];
		const portrait = entry.identity.imageUrl;

		const picks: { path: string; label: string }[] = [];
		const spec = str(args.images).trim();
		if (!spec) {
			// Default set: portrait first, then the newest gallery images up to the cap.
			if (portrait) picks.push({ path: portrait, label: 'portrait' });
			const room = DEFAULT_VIEW_IMAGES - picks.length;
			const start = Math.max(0, gallery.length - room);
			for (let i = start; i < gallery.length; i += 1) {
				picks.push({ path: gallery[i], label: `gallery image ${i + 1}` });
			}
			if (!picks.length) throw new ToolError(`${entry.identity.name} has no images.`);
		} else {
			const tokens = spec.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
			if (!tokens.length) throw new ToolError('`images` must name "portrait" and/or gallery numbers, e.g. "portrait, 1, 2".');
			if (tokens.length > MAX_VIEW_IMAGES) {
				throw new ToolError(`Too many images requested (${tokens.length}): the cap is ${MAX_VIEW_IMAGES} per call. Pick the ones that matter.`);
			}
			const seen = new Set<string>();
			for (const token of tokens) {
				let path: string;
				let label: string;
				if (token === 'portrait') {
					if (!portrait) throw new ToolError(`${entry.identity.name} has no portrait.${gallery.length ? ` It has ${gallery.length} gallery image(s).` : ''}`);
					path = portrait;
					label = 'portrait';
				} else {
					// Whole numbers only: Math.floor(Number("1.5")) would silently view image 1.
					const n = /^\d+$/.test(token) ? Number(token) : NaN;
					if (!Number.isFinite(n) || n < 1 || n > gallery.length) {
						throw new ToolError(
							gallery.length
								? `"${token}" is not a valid image: use "portrait" or a gallery number 1 to ${gallery.length}.`
								: `"${token}" is not a valid image: ${entry.identity.name} has no gallery, so only "portrait" is available.`
						);
					}
					path = gallery[n - 1];
					label = `gallery image ${n}`;
				}
				if (seen.has(path)) continue;
				seen.add(path);
				picks.push({ path, label });
			}
		}

		// Validate every file now, inside the tool, so a missing/unsupported one fails
		// THIS call naming the image instead of sinking the whole next model request.
		for (const pick of picks) {
			try {
				loadImage(pick.path);
			} catch (e) {
				throw new ToolError(`Could not load the ${pick.label} of ${entry.identity.name}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		const labels = picks.map((p) => p.label).join(', ');
		return {
			uiResult: {
				type: 'view_character_images',
				id: entry.id,
				name: entry.identity.name,
				label: `Viewed ${picks.length === 1 ? labels : `${picks.length} images`} of ${entry.identity.name}`
			},
			toolMessage: JSON.stringify({ ok: true, note: `Attached in the next message: ${labels} of ${entry.identity.name}.` }),
			injectImages: picks.map((p) => p.path)
		};
	}
};

// ===== writing entry art =====

/** Where a copied image lands, per entry type: art follows the entry, not the chat. */
const ART_CATEGORY = { character: 'characters', persona: 'personas' } as const;

const IMAGE_ACTIONS = ['set_portrait', 'add_to_gallery', 'remove_from_gallery', 'clear_portrait'] as const;
type ImageAction = (typeof IMAGE_ACTIONS)[number];

/** An image the tool is allowed to name: a user upload, or one of an entry's own. */
type GalleryRef = { kind: 'gallery'; index: number };
type ImageRef = { kind: 'attachment'; index: number } | { kind: 'portrait' } | GalleryRef;

/**
 * The entry a `portrait` / gallery-number reference resolves against. With no `sourceId` that
 * is the target itself (`isTarget`), which is what makes "already the portrait" a real refusal
 * rather than a copy of a picture onto itself.
 */
interface ImageSource {
	entry: RawLibraryEntry;
	gallery: string[];
	isTarget: boolean;
}

/**
 * Resolves the model's image reference against the only reachable sets: the images the user
 * attached in this conversation, and one entry's stored art. A path is never taken from the
 * model, so it can't be pointed at an arbitrary file.
 *
 * Attachments are numbered oldest-first and the list only grows, so "attachment 3" means the
 * same picture for the whole life of the tab. A bare "attachment" means this turn's, and
 * refuses to guess when the user attached several.
 */
function parseImageRef(raw: string, ctx: AssistantContext, source: ImageSource): ImageRef {
	const all = ctx.userImages ?? [];
	const turn = ctx.turnImages ?? [];
	const s = raw.trim().toLowerCase();

	const attachment = s.match(/^attachment\s*(\d+)?$/);
	if (attachment) {
		if (!all.length) throw new ToolError("The user hasn't attached any image in this conversation. Ask them to attach one with the composer's image button.");
		if (!attachment[1]) {
			// Bare "attachment" (or an omitted reference) = what they just sent.
			if (!turn.length) throw new ToolError(`The user attached nothing to this message. Name an earlier one instead: "attachment 1" to "attachment ${all.length}", oldest first.`);
			if (turn.length > 1) throw new ToolError(`The user attached ${turn.length} images to this message. Name one: "attachment ${all.length - turn.length + 1}" to "attachment ${all.length}".`);
			return { kind: 'attachment', index: all.length - 1 };
		}
		const n = Number(attachment[1]);
		if (n < 1 || n > all.length) {
			throw new ToolError(`There is no "attachment ${n}": the user has attached ${all.length} image(s) in this conversation, numbered 1 to ${all.length} oldest first.`);
		}
		return { kind: 'attachment', index: n - 1 };
	}
	if (s === 'portrait') return { kind: 'portrait' };
	if (/^\d+$/.test(s)) {
		const n = Number(s);
		const owner = source.entry.identity.name;
		if (!source.gallery.length) throw new ToolError(`${owner} has no gallery images to number.`);
		if (n < 1 || n > source.gallery.length) throw new ToolError(`"${s}" is not one of ${owner}'s ${source.gallery.length} gallery image(s): use 1 to ${source.gallery.length}, oldest first.`);
		return { kind: 'gallery', index: n - 1 };
	}
	throw new ToolError(`"${raw}" is not an image reference. Use "attachment N" (the user's uploads, oldest first), "portrait", or a 1-based gallery number.`);
}

/** How a reference reads on a card and in a result. A source that is not the target is named,
 *  because "the portrait" says nothing on a call that moves art between two entries. */
function describeRef(ref: ImageRef, source: ImageSource): string {
	if (ref.kind === 'attachment') return `attachment ${ref.index + 1}`;
	if (source.isTarget) return ref.kind === 'portrait' ? 'the portrait' : `gallery image ${ref.index + 1}`;
	const owner = source.entry.identity.name;
	return ref.kind === 'portrait' ? `${owner}'s portrait` : `${owner}'s gallery image ${ref.index + 1}`;
}

/** Exactly what a call would do, once every argument has been checked. */
type ImagePlan =
	| { action: 'clear_portrait' }
	| { action: 'remove_from_gallery'; ref: GalleryRef; source: ImageSource }
	| { action: 'set_portrait' | 'add_to_gallery'; ref: ImageRef; source: ImageSource; path: string };

/**
 * The whole call, decided before a byte moves: which action, which entry a reference resolves
 * against, which file it names, and every refusal on the way there.
 *
 * `run` and `preview` share it, which is what makes the approval card exact: the card cannot
 * describe a copy the call then refuses, and no refusal can arrive after the user has approved
 * it. `own` carries the target and the gallery array the caller will write back.
 */
function planEdit(args: Record<string, unknown>, ctx: AssistantContext, own: ImageSource): ImagePlan {
	const requested = str(args.action).trim();
	if (!(IMAGE_ACTIONS as readonly string[]).includes(requested)) {
		throw new ToolError(`\`action\` must be one of: ${IMAGE_ACTIONS.join(', ')}; got "${requested}".`);
	}
	const action = requested as ImageAction;
	const raw = str(args.image).trim();
	const sourceId = str(args.sourceId).trim();

	if (action === 'clear_portrait') {
		if (raw) throw new ToolError('clear_portrait takes no `image`: it removes whatever portrait is set.');
		if (sourceId) throw new ToolError('clear_portrait takes no `sourceId`: it only removes the portrait this entry already has.');
		if (!own.entry.identity.imageUrl) throw new ToolError(`${own.entry.identity.name} has no portrait to clear.`);
		return { action };
	}

	if (action === 'remove_from_gallery') {
		if (sourceId) throw new ToolError('remove_from_gallery takes no `sourceId`: it only drops an image from this entry\'s own gallery.');
		if (!raw) throw new ToolError('remove_from_gallery needs a gallery number; a read of the entry reports how many it has.');
		const ref = parseImageRef(raw, ctx, own);
		if (ref.kind !== 'gallery') throw new ToolError(`remove_from_gallery takes a gallery number, not ${describeRef(ref, own)}.`);
		return { action, ref, source: own };
	}

	// set_portrait / add_to_gallery: both consume a source image and copy it. A `sourceId`
	// naming the target IS the target, so the no-op guards below still fire.
	let source = own;
	if (sourceId && sourceId !== own.entry.id) {
		const from = loadImageEntry(sourceId, 'sourceId');
		source = { entry: from, gallery: from.identity.gallery ?? [], isTarget: false };
	}
	const ref = parseImageRef(raw || 'attachment', ctx, source);
	// An attachment belongs to the conversation, not to an entry. Naming both is a
	// contradiction, and quietly honouring one of them files a picture nobody asked for.
	if (!source.isTarget && ref.kind === 'attachment') {
		throw new ToolError('`sourceId` names the entry whose "portrait" or gallery number to copy, so it cannot be combined with an attachment. Drop one of the two.');
	}
	// A copy of a picture onto itself is a no-op, and only the entry's OWN art can be one.
	if (source.isTarget) {
		if (action === 'set_portrait' && ref.kind === 'portrait') throw new ToolError(`That image is already the portrait of ${own.entry.identity.name}.`);
		if (action === 'add_to_gallery' && ref.kind === 'gallery') throw new ToolError(`${describeRef(ref, source)} is already in the gallery.`);
	}

	let path: string;
	if (ref.kind === 'attachment') path = (ctx.userImages ?? [])[ref.index];
	else if (ref.kind === 'portrait') {
		const portrait = source.entry.identity.imageUrl;
		if (!portrait) throw new ToolError(`${source.entry.identity.name} has no portrait to copy.`);
		path = portrait;
	} else path = source.gallery[ref.index];

	// Read the file here, before anything is written and before the card promises a copy:
	// a broken source fails naming the image instead of leaving the entry's art half-updated.
	try {
		loadImage(path);
	} catch (e) {
		throw new ToolError(`Cannot read ${describeRef(ref, source)}: ${e instanceof Error ? e.message : String(e)}`);
	}
	return { action, ref, source, path };
}

/**
 * The write half of entry art (look → edit): set or replace a portrait, add or remove a gallery
 * image, clear a portrait. It works on any character or persona, and copies from any source the
 * user or the library already owns. Building a card from a fresh upload is one of its uses,
 * not its purpose.
 *
 * It belongs to the WRITING family, not Images (groups.ts). Images governs LOOKING at library
 * art (a cost-and-consent question about sending pictures to a model), while this only
 * rearranges pictures the user already brought or already owns, and sends nothing anywhere.
 * Filing it with the reads would have taken "make a character from this picture" away from
 * everyone who has image reading switched off, which is the default.
 *
 * Ownership rule: a source image is always COPIED into the entry's own folder (so clearing the
 * chat can never blank a portrait, dropping a gallery image can never blank the portrait
 * promoted from it, and lending one entry's portrait to another leaves the lender untouched),
 * and a removal only UNLINKS: the assistant never deletes bytes.
 */
export const editCharacterImages: Capability = {
	name: 'edit_character_images',
	summary:
		'Change the images of a character or persona: set/replace its portrait, add or remove a gallery image, or clear the portrait. Copies from the user\'s attachments or from any entry\'s own art, so "give Mira the portrait of Aria" is one call and "make a character from this picture" is create_entity followed by this one. A removal unlinks the image; it never deletes the file.',
	risk: 'write',
	// Three of the shapes this call takes leave the entry with one picture fewer and nothing
	// naming the old one: clearing a portrait, dropping a gallery image, and replacing a
	// portrait. Setting a FIRST portrait or adding to a gallery takes nothing away. Only the
	// arguments say which this is, so the preview decides.
	escalates: true,
	params: [
		{ name: 'id', type: 'string', describe: 'Character or persona id, the entry being changed.', required: true },
		{ name: 'action', type: 'string', describe: 'What to do.', required: true, enum: IMAGE_ACTIONS },
		{
			name: 'image',
			type: 'string',
			describe:
				'Which image: "attachment N" for the user\'s uploads in this conversation, "portrait", or a gallery number (both 1-based and oldest first). Omit for clear_portrait, or to mean the attachment they just sent.'
		},
		{
			name: 'sourceId',
			type: 'string',
			describe:
				'Copy from ANOTHER entry: the character or persona whose "portrait" or gallery number `image` names. Omit to use the target\'s own art. Only for set_portrait and add_to_gallery, and never together with an attachment.'
		}
	],
	run(args, ctx) {
		const entry = loadImageEntry(str(args.id));
		const gallery = [...(entry.identity.gallery ?? [])];
		const own: ImageSource = { entry, gallery, isTarget: true };
		const plan = planEdit(args, ctx, own);

		let label: string;
		let detail: Record<string, unknown> = {};

		if (plan.action === 'clear_portrait') {
			delete entry.identity.imageUrl;
			label = `Cleared the portrait of ${entry.identity.name}`;
		} else if (plan.action === 'remove_from_gallery') {
			gallery.splice(plan.ref.index, 1);
			entry.identity.gallery = gallery;
			label = `Removed gallery image ${plan.ref.index + 1} from ${entry.identity.name}`;
			detail = { galleryCount: gallery.length };
		} else {
			const from = describeRef(plan.ref, plan.source);
			const copied = copyImage(plan.path, ART_CATEGORY[entry.type]);
			if (!copied) throw new ToolError(`${from} is gone from storage ("${plan.path}").`);
			if (plan.action === 'set_portrait') {
				const replaced = !!entry.identity.imageUrl;
				entry.identity.imageUrl = copied;
				label = `${replaced ? 'Replaced' : 'Set'} the portrait of ${entry.identity.name} from ${from}`;
			} else {
				gallery.push(copied);
				entry.identity.gallery = gallery;
				label = `Added ${from} to the gallery of ${entry.identity.name}`;
				detail = { galleryCount: gallery.length };
			}
		}

		// An empty set means "no such key" in a stored entry, not an empty string/array.
		if (!entry.identity.gallery?.length) delete entry.identity.gallery;
		entry.updatedAt = Date.now();
		serverDb.updateLibraryEntry(entry);
		ctx.broadcast('library');

		return ok(
			{ type: 'edit_character_images', kind: entry.type, id: entry.id, name: entry.identity.name, label },
			// The TARGET is re-claimed; a cross-entry copy leaves the source untouched.
			{ kind: entry.type, id: entry.id, action: plan.action, ...detail, ...stampState([entry.type, entry.id]) }
		);
	},
	preview(args, ctx) {
		const entry = loadImageEntry(str(args.id));
		const own: ImageSource = { entry, gallery: [...(entry.identity.gallery ?? [])], isTarget: true };
		const plan = planEdit(args, ctx, own);
		const base = { label: entry.identity.name, target: { kind: entry.type, id: entry.id } as const };

		// The two removals and a replacement all end with the entry naming one picture fewer,
		// and nothing in the app puts it back, which is what earns them the delete rung and the
		// permanent mark the card draws from it.
		if (plan.action === 'clear_portrait') {
			return { ...base, act: 'Clear portrait', risk: 'delete', notes: [{ text: 'The picture file stays; only this entry stops using it.' }] };
		}
		if (plan.action === 'remove_from_gallery') {
			return {
				...base,
				act: 'Remove gallery image',
				risk: 'delete',
				notes: [{ text: `Drops ${describeRef(plan.ref, plan.source)}. The file stays on disk for anything else pointing at it.` }]
			};
		}
		const replacing = plan.action === 'set_portrait' && !!entry.identity.imageUrl;
		return {
			...base,
			act: plan.action === 'set_portrait' ? (replacing ? 'Replace portrait' : 'Set portrait') : 'Add gallery image',
			notes: [{ text: `Copies ${describeRef(plan.ref, plan.source)} into ${entry.identity.name}'s own art.` }],
			// Nothing in the app can bring the old portrait back once the entry stops naming it.
			// Setting a FIRST portrait takes nothing away and stays an ordinary write.
			...(replacing
				? {
						risk: 'delete' as const,
						actNotes: [{ text: 'The picture it replaces stays on disk, but nothing in the app points at it any more.', warn: true }]
					}
				: {})
		};
	}
};
