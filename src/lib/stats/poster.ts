/**
 * The share pictures: a deck of portrait cards, drawn on a canvas.
 *
 * **Portrait, not square.** These are made to be posted, and every place they land (a phone
 * camera roll, a story, a chat) is 9:16. A square picture arrives letterboxed on all of them.
 *
 * **Four cards at most, and every one ships full.** The deck is what you wrote, who you wrote
 * it with, when you wrote it, and the records you set along the way, because those are the
 * four questions the panel answers and each has enough material to fill a page of its own.
 * `posterCards` drops a card the snapshot cannot fill rather than drawing a heading over
 * empty space, which reads as a picture that failed to load instead of one with room to
 * breathe.
 *
 * **Drawn, never screenshotted.** Rasterising the DOM would mean a library the app does not
 * have, and it would inherit the panel's scrolling, its glass and its exact width, none of
 * which belong in a picture meant to be looked at on a phone.
 *
 * **They wear the reader's own theme**, resolved off the live document rather than hardcoded,
 * so what gets shared looks like the app they are running. Colours come back through a probe
 * element instead of `getPropertyValue`, because the `--color-*` names are aliases onto
 * `--theme-*` and reading them raw returns the literal `var(…)` text. The big figures are
 * set in the reader's own story face (`--font-body`) with the UI face around them, so the
 * cards carry the app's two voices instead of one.
 *
 * Fonts are the document's own and are only safe to draw with once they have loaded. Canvas
 * silently substitutes a system face for one still in flight, so `drawPoster` explicitly
 * `document.fonts.load`s every weight it draws with before touching the canvas:
 * `fonts.ready` alone only covers faces something on screen already asked for.
 */
import type { StatsSnapshot } from '$lib/stores/stats.svelte';
import {
	count,
	plural,
	hourLabel,
	dayLabel,
	dateLabel,
	monthYearLabel,
	share,
	bookComparison,
	comparisonLabel
} from './format';
import { startOfLocalDay, nextLocalDay } from './derive';

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1920;

/** The margin every card lays out against, and the width left inside it. */
const PAD = 96;
const INNER = POSTER_WIDTH - PAD * 2;

/** The hairline frame every card sits in, so the picture keeps its own edge on
 *  whatever background it gets posted onto. */
const FRAME = 40;

export type PosterCardId = 'writing' | 'cast' | 'time' | 'records';

export interface PosterCard {
	id: PosterCardId;
	/** What the dialog calls it on its pager. */
	label: string;
}

export interface PosterOptions {
	/** Replaces every character name with a placeholder and drops the portraits with them.
	 *  The names are the one thing on these cards that identifies what the reader plays, so
	 *  this is offered at the point of making the picture rather than buried in a setting. */
	anonymous: boolean;
	/** Portraits, resolved by the caller (they come from the image service, which is async).
	 *  Keyed by character id; a missing one draws as an initial. */
	portraits: Record<string, HTMLImageElement>;
	/** Character id → display name, so the drawing never reaches into a store. */
	names: Record<string, string>;
}

/** One superlative for the records card: a figure and the sentence under it. */
interface RecordEntry {
	value: string;
	label: string;
}

/** Everything the records card could say, in the order it says it. Only real figures make
 *  the list; a zero that means "never happened" is left out rather than framed as a record. */
function recordEntries(snapshot: StatsSnapshot): RecordEntry[] {
	const { records, shape } = snapshot.stats;
	const entries: RecordEntry[] = [];
	if (records.longestReply) {
		entries.push({ value: count(records.longestReply.words), label: 'words in the longest reply you were sent' });
	}
	if (records.longestUserTurn) {
		entries.push({ value: count(records.longestUserTurn.words), label: 'words in your longest single message' });
	}
	if (snapshot.busiest) {
		entries.push({
			value: count(snapshot.busiest.count),
			label: `messages on your busiest day, ${dayLabel(snapshot.busiest.key)}`
		});
	}
	if (shape.longestStory > 0) {
		entries.push({ value: count(shape.longestStory), label: 'turns in your longest chat' });
	}
	if (shape.abandoned > 0) {
		entries.push({ value: count(shape.abandoned), label: 'turns you wrote and left behind' });
	}
	if (snapshot.longest.days > 1) {
		entries.push({ value: count(snapshot.longest.days), label: 'days in your longest run of writing' });
	}
	return entries;
}

/**
 * Which cards this snapshot can fill, in the order they are shown. A card with nothing to
 * say is left out rather than drawn empty. `names` decides the cast card: a counted
 * character the library no longer holds has no name and no face, and a card of unlabelled
 * bars is not a picture anyone posts.
 */
export function posterCards(snapshot: StatsSnapshot, names: Record<string, string>): PosterCard[] {
	const cards: PosterCard[] = [{ id: 'writing', label: 'What you wrote' }];
	if (snapshot.stats.cast.some((m) => names[m.characterId])) {
		cards.push({ id: 'cast', label: 'Your cast' });
	}
	if (snapshot.days.length) cards.push({ id: 'time', label: 'When you wrote' });
	// A lead figure, four for the grid, and the first-words line: fewer and the page
	// shows its gaps.
	if (recordEntries(snapshot).length >= 5 && snapshot.stats.records.firstMessageAt !== null) {
		cards.push({ id: 'records', label: 'For the record' });
	}
	return cards;
}

interface Palette {
	bg: string;
	surface: string;
	text: string;
	secondary: string;
	muted: string;
	accent: string;
	border: string;
	/** The UI face, for labels and small print. */
	sans: string;
	/** The story face, for every big figure: the cards speak in the app's two voices. */
	serif: string;
}

/** Resolve the live theme through a probe, so `color-mix` and aliases come back as real
 *  values. The probe is attached because a detached element has no computed style. */
function readPalette(): Palette {
	const probe = document.createElement('div');
	probe.style.position = 'fixed';
	probe.style.opacity = '0';
	probe.style.pointerEvents = 'none';
	document.body.appendChild(probe);
	const read = (value: string): string => {
		probe.style.color = '';
		probe.style.color = value;
		return getComputedStyle(probe).color;
	};
	const face = (value: string): string => {
		probe.style.fontFamily = value;
		return getComputedStyle(probe).fontFamily || 'sans-serif';
	};
	try {
		return {
			bg: read('var(--color-bg-primary)'),
			surface: read('var(--color-bg-secondary)'),
			text: read('var(--color-text-primary)'),
			secondary: read('var(--color-text-secondary)'),
			muted: read('var(--color-text-muted)'),
			accent: read('var(--color-accent)'),
			border: read('var(--color-border-subtle)'),
			sans: face('var(--font-ui)'),
			serif: face('var(--font-body)')
		};
	} finally {
		probe.remove();
	}
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/** Mix two resolved `rgb(…)` colours. Canvas has no `color-mix`, and these cards need it for
 *  the background wash and the heatmap's four steps. */
function mix(from: string, to: string, amount: number): string {
	const parse = (value: string): [number, number, number] => {
		const parts = value.match(/[\d.]+/g);
		if (!parts || parts.length < 3) return [0, 0, 0];
		return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
	};
	const a = parse(from);
	const b = parse(to);
	const at = (i: number) => Math.round(a[i] + (b[i] - a[i]) * amount);
	return `rgb(${at(0)}, ${at(1)}, ${at(2)})`;
}

/** Monday of the week `at` falls in, the heatmap's column key. */
function startOfWeek(at: number): number {
	const date = new Date(at);
	const shift = (date.getDay() + 6) % 7;
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() - shift).getTime();
}

/** Where each card's light comes from, as fractions of the card: a main glow and a fainter
 *  answer in the opposite corner, so the deck reads as one set without being the same
 *  picture four times. */
const WASH: Record<PosterCardId, { main: [number, number]; echo: [number, number] }> = {
	writing: { main: [0.86, 0.08], echo: [0.08, 0.94] },
	cast: { main: [0.5, 0.16], echo: [0.5, 1.04] },
	time: { main: [0.12, 0.08], echo: [0.92, 0.94] },
	records: { main: [0.9, 0.92], echo: [0.08, 0.08] }
};

/**
 * Draw one card. Resolves once the canvas holds it, so the caller can encode straight after.
 */
export async function drawPoster(
	canvas: HTMLCanvasElement,
	snapshot: StatsSnapshot,
	options: PosterOptions,
	card: PosterCardId
): Promise<void> {
	const palette = readPalette();

	// Every weight the cards set, asked for by name: `fonts.ready` only covers faces the
	// page has already used somewhere, and a canvas quietly substitutes for the rest.
	await Promise.all(
		[
			`400 32px ${palette.sans}`,
			`500 32px ${palette.sans}`,
			`600 32px ${palette.sans}`,
			`700 32px ${palette.sans}`,
			`400 32px ${palette.serif}`,
			`700 32px ${palette.serif}`
		].map((font) => document.fonts.load(font))
	);
	await document.fonts.ready;

	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');

	canvas.width = POSTER_WIDTH;
	canvas.height = POSTER_HEIGHT;
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';

	paintBackground(ctx, palette, card);
	if (card === 'writing') drawWriting(ctx, palette, snapshot);
	else if (card === 'cast') drawCast(ctx, palette, snapshot, options);
	else if (card === 'time') drawTime(ctx, palette, snapshot);
	else drawRecords(ctx, palette, snapshot);
	drawFoot(ctx, palette, snapshot);
}

function paintBackground(ctx: CanvasRenderingContext2D, palette: Palette, card: PosterCardId): void {
	ctx.fillStyle = palette.bg;
	ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

	const glow = (at: [number, number], strength: number, reach: number): void => {
		const [fx, fy] = at;
		const light = ctx.createRadialGradient(
			POSTER_WIDTH * fx,
			POSTER_HEIGHT * fy,
			0,
			POSTER_WIDTH * fx,
			POSTER_HEIGHT * fy,
			POSTER_WIDTH * reach
		);
		// Ends on the background itself, so the wash has no edge to see.
		light.addColorStop(0, mix(palette.bg, palette.accent, strength));
		light.addColorStop(1, palette.bg);
		ctx.fillStyle = light;
		ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
	};
	glow(WASH[card].main, 0.24, 1.1);
	glow(WASH[card].echo, 0.1, 0.9);

	// The frame: a hairline just inside the edge, so the card keeps its shape when it is
	// posted onto a background the same colour as its own.
	ctx.strokeStyle = mix(palette.border, palette.accent, 0.18);
	ctx.lineWidth = 2;
	roundedRect(ctx, FRAME, FRAME, POSTER_WIDTH - FRAME * 2, POSTER_HEIGHT - FRAME * 2, 44);
	ctx.stroke();
}

/** The wordmark, which is the whole reason these pictures exist, and the day it was counted. */
function drawFoot(ctx: CanvasRenderingContext2D, palette: Palette, snapshot: StatsSnapshot): void {
	const y = POSTER_HEIGHT - 112;

	ctx.fillStyle = palette.accent;
	ctx.beginPath();
	ctx.arc(PAD + 8, y - 11, 8, 0, Math.PI * 2);
	ctx.fill();
	ctx.font = `700 34px ${palette.sans}`;
	ctx.fillText('ChungusHub', PAD + 30, y);

	ctx.fillStyle = palette.muted;
	ctx.font = `400 28px ${palette.sans}`;
	ctx.textAlign = 'right';
	ctx.fillText(dateLabel(snapshot.takenAt), POSTER_WIDTH - PAD, y);
	ctx.textAlign = 'left';
}

/** A heading, letter-spaced by hand: canvas letter spacing is not everywhere yet. */
function drawEyebrow(ctx: CanvasRenderingContext2D, palette: Palette, text: string, y: number, size = 28): void {
	ctx.fillStyle = palette.muted;
	ctx.font = `600 ${size}px ${palette.sans}`;
	let x = PAD;
	for (const ch of text) {
		ctx.fillText(ch, x, y);
		x += ctx.measureText(ch).width + 5;
	}
	// A short accent rule under the words, the same mark the panel's section titles carry.
	ctx.fillStyle = palette.accent;
	ctx.fillRect(PAD, y + 18, 56, 4);
}

/** Shrink a font until the text fits the width it has. Leaves `ctx.font` set to the size
 *  that fit, so the caller draws with it. */
function fitFont(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	size: number,
	weight: number,
	family: string
): void {
	let px = size;
	ctx.font = `${weight} ${px}px ${family}`;
	while (px > 28 && ctx.measureText(text).width > maxWidth) {
		px -= 4;
		ctx.font = `${weight} ${px}px ${family}`;
	}
}

/** Break a sentence to the width it has. Measured with whatever font is set. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(' ')) {
		const next = line ? `${line} ${word}` : word;
		if (line && ctx.measureText(next).width > maxWidth) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/** Cut a name to the width it has, with an elision rather than a hard stop. */
function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let cut = text;
	while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
	return `${cut}…`;
}

/** The hero every card opens with: the one figure in the story face, its unit under it. */
function drawHero(
	ctx: CanvasRenderingContext2D,
	palette: Palette,
	figure: string,
	unit: string,
	baseline: number,
	size: number
): void {
	ctx.fillStyle = palette.text;
	fitFont(ctx, figure, INNER, size, 700, palette.serif);
	ctx.fillText(figure, PAD, baseline);

	ctx.fillStyle = palette.secondary;
	ctx.font = `500 44px ${palette.sans}`;
	ctx.fillText(unit, PAD, baseline + 78);
}

/** A label on the left, its figure on the right, over a hairline. */
function drawStatLine(ctx: CanvasRenderingContext2D, palette: Palette, label: string, value: string, y: number): void {
	ctx.fillStyle = palette.muted;
	ctx.font = `400 30px ${palette.sans}`;
	ctx.fillText(label, PAD, y);

	ctx.fillStyle = palette.text;
	ctx.font = `600 34px ${palette.sans}`;
	ctx.textAlign = 'right';
	ctx.fillText(value, PAD + INNER, y);
	ctx.textAlign = 'left';

	ctx.strokeStyle = palette.border;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(PAD, y + 28);
	ctx.lineTo(PAD + INNER, y + 28);
	ctx.stroke();
}

function drawTile(
	ctx: CanvasRenderingContext2D,
	palette: Palette,
	x: number,
	y: number,
	w: number,
	figure: string,
	label: string
): void {
	ctx.fillStyle = palette.surface;
	roundedRect(ctx, x, y, w, 200, 28);
	ctx.fill();
	ctx.strokeStyle = palette.border;
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.fillStyle = palette.text;
	fitFont(ctx, figure, w - 64, 66, 700, palette.serif);
	ctx.fillText(figure, x + 32, y + 112);

	ctx.fillStyle = palette.muted;
	fitFont(ctx, label, w - 64, 28, 400, palette.sans);
	ctx.fillText(label, x + 32, y + 158);
}

/** A face in a rounded box, cover-fitted the way every avatar in the app is, falling back
 *  to an initial when there is no picture to draw. */
function drawFace(
	ctx: CanvasRenderingContext2D,
	palette: Palette,
	portrait: HTMLImageElement | undefined,
	name: string,
	x: number,
	y: number,
	size: number
): void {
	ctx.save();
	roundedRect(ctx, x, y, size, size, Math.round(size * 0.16));
	ctx.clip();
	if (portrait) {
		// Cover fit: the shorter side decides the scale, the rest is cropped.
		const scale = Math.max(size / portrait.width, size / portrait.height);
		const w = portrait.width * scale;
		const h = portrait.height * scale;
		ctx.drawImage(portrait, x + (size - w) / 2, y + (size - h) / 2, w, h);
	} else {
		ctx.fillStyle = mix(palette.surface, palette.accent, 0.14);
		ctx.fillRect(x, y, size, size);
		ctx.fillStyle = palette.muted;
		ctx.font = `600 ${Math.round(size * 0.42)}px ${palette.sans}`;
		ctx.textAlign = 'center';
		ctx.fillText((name.trim()[0] ?? '?').toUpperCase(), x + size / 2, y + size * 0.65);
		ctx.textAlign = 'left';
	}
	ctx.restore();

	ctx.strokeStyle = palette.border;
	ctx.lineWidth = 1;
	roundedRect(ctx, x, y, size, size, Math.round(size * 0.16));
	ctx.stroke();
}

// ===== The cards =====

/** What you wrote: the one big number, the four that frame it, and whose words they were. */
function drawWriting(ctx: CanvasRenderingContext2D, palette: Palette, snapshot: StatsSnapshot): void {
	const stats = snapshot.stats;
	drawEyebrow(ctx, palette, 'WHAT YOU WROTE', 216);

	drawHero(ctx, palette, count(stats.effort.words), 'words written', 566, 200);

	const comparison = bookComparison(stats.effort.words);
	if (comparison) {
		ctx.fillStyle = palette.muted;
		ctx.font = `400 36px ${palette.serif}`;
		wrap(ctx, `About as long as ${comparisonLabel(comparison)}.`, INNER).forEach((line, i) => {
			ctx.fillText(line, PAD, 726 + i * 50);
		});
	}

	const gap = 26;
	const tileWidth = (INNER - gap) / 2;
	const tiles: [string, string][] = [
		[count(stats.effort.messages), stats.effort.messages === 1 ? 'turn' : 'turns'],
		[count(stats.library.chats), stats.library.chats === 1 ? 'chat' : 'chats'],
		[count(snapshot.days.length), snapshot.days.length === 1 ? 'day written on' : 'days written on'],
		[count(stats.effort.userWords), 'words of your own']
	];
	tiles.forEach(([figure, label], i) => {
		const x = PAD + (i % 2) * (tileWidth + gap);
		drawTile(ctx, palette, x, 856 + Math.floor(i / 2) * (200 + gap), tileWidth, figure, label);
	});

	// Whose words the page is: the reader's share against everyone they wrote with,
	// drawn as one split bar because a share is a shape before it is a number.
	const yourShare = share(stats.effort.userWords, stats.effort.words);
	if (yourShare !== null) {
		drawEyebrow(ctx, palette, 'WHOSE WORDS', 1408, 24);

		const barY = 1472;
		const barH = 56;
		const split = Math.round((INNER * Math.min(100, Math.max(0, yourShare))) / 100);
		ctx.save();
		roundedRect(ctx, PAD, barY, INNER, barH, 18);
		ctx.clip();
		ctx.fillStyle = palette.surface;
		ctx.fillRect(PAD, barY, INNER, barH);
		if (split > 0) {
			ctx.fillStyle = palette.accent;
			ctx.fillRect(PAD, barY, split, barH);
		}
		ctx.restore();

		ctx.fillStyle = palette.text;
		ctx.font = `600 30px ${palette.sans}`;
		ctx.fillText(`You · ${count(stats.effort.userWords)} words`, PAD, barY + barH + 52);

		// "Everyone else", not "your cast": the remainder holds system turns too, and the
		// two sides of one bar must sum to the total it is drawn against.
		ctx.fillStyle = palette.muted;
		ctx.textAlign = 'right';
		ctx.fillText(
			`Everyone else · ${count(stats.effort.words - stats.effort.userWords)} words`,
			PAD + INNER,
			barY + barH + 52
		);
		ctx.textAlign = 'left';

		ctx.fillStyle = palette.secondary;
		ctx.font = `400 30px ${palette.sans}`;
		ctx.fillText(`${yourShare}% of every word on the page is yours.`, PAD, barY + barH + 116);
	}
}

/** Your cast: the one you wrote most with, at a size worth looking at, and the runners-up. */
function drawCast(
	ctx: CanvasRenderingContext2D,
	palette: Palette,
	snapshot: StatsSnapshot,
	options: PosterOptions
): void {
	const named = snapshot.stats.cast.filter((m) => options.names[m.characterId]).slice(0, 5);
	const label = (index: number, id: string): string =>
		options.anonymous ? `Character ${index + 1}` : options.names[id];

	drawEyebrow(ctx, palette, 'YOUR CAST', 216);

	const lead = named[0];
	const leadName = label(0, lead.characterId);
	const face = 380;
	drawFace(
		ctx,
		palette,
		options.anonymous ? undefined : options.portraits[lead.characterId],
		leadName,
		(POSTER_WIDTH - face) / 2,
		300,
		face
	);

	ctx.textAlign = 'center';
	ctx.fillStyle = palette.text;
	fitFont(ctx, leadName, INNER, 80, 700, palette.serif);
	ctx.fillText(clip(ctx, leadName, INNER), POSTER_WIDTH / 2, 796);

	ctx.fillStyle = palette.secondary;
	ctx.font = `500 34px ${palette.sans}`;
	ctx.fillText(`${plural(lead.messages, 'turn')} · ${count(lead.words)} words`, POSTER_WIDTH / 2, 856);

	ctx.fillStyle = palette.muted;
	ctx.font = `400 30px ${palette.sans}`;
	ctx.fillText(`With you since ${monthYearLabel(lead.firstAt)}`, POSTER_WIDTH / 2, 906);
	ctx.textAlign = 'left';

	const runners = named.slice(1);
	if (runners.length) {
		const top = lead.messages;
		// The block is centred in the space under the hero: a short list pinned to its top
		// would leave the foot of the page reading as a card that ran out of things to say.
		const pitch = runners.length > 3 ? 152 : 190;
		const start = 1010 + Math.max(0, (700 - runners.length * pitch) / 2);
		runners.forEach((member, i) => {
			const y = start + i * pitch;
			const name = label(i + 1, member.characterId);
			drawFace(ctx, palette, options.anonymous ? undefined : options.portraits[member.characterId], name, PAD, y, 116);

			const textX = PAD + 116 + 32;
			const textW = INNER - 116 - 32;

			ctx.fillStyle = palette.muted;
			ctx.font = `600 26px ${palette.sans}`;
			ctx.fillText(`${i + 2}`, textX, y + 40);

			ctx.fillStyle = palette.text;
			ctx.font = `600 34px ${palette.sans}`;
			ctx.fillText(clip(ctx, name, textW - 260), textX + 44, y + 40);

			ctx.fillStyle = palette.secondary;
			ctx.font = `400 30px ${palette.sans}`;
			ctx.textAlign = 'right';
			ctx.fillText(plural(member.messages, 'turn'), PAD + INNER, y + 40);
			ctx.textAlign = 'left';

			// The bar keeps the ranking honest at a glance: everyone is drawn against the lead.
			const trackY = y + 72;
			ctx.fillStyle = palette.surface;
			roundedRect(ctx, textX, trackY, textW, 14, 7);
			ctx.fill();
			ctx.fillStyle = palette.accent;
			roundedRect(ctx, textX, trackY, Math.max(14, (member.messages / top) * textW), 14, 7);
			ctx.fill();
		});
	} else {
		// A cast of one still fills its page: the figures between the two of you.
		let y = 1060;
		drawStatLine(ctx, palette, 'Chats together', count(lead.chats), y);
		y += 96;
		drawStatLine(ctx, palette, 'Words between you', count(lead.words), y);
		y += 96;
		drawStatLine(ctx, palette, 'First wrote', dateLabel(lead.firstAt), y);
		y += 96;
		drawStatLine(ctx, palette, 'Last wrote', dateLabel(lead.lastAt), y);
	}
}

/** When you wrote: the calendar, the runs that come off it, and the shape of a day. */
function drawTime(ctx: CanvasRenderingContext2D, palette: Palette, snapshot: StatsSnapshot): void {
	drawEyebrow(ctx, palette, 'WHEN YOU WROTE', 216);

	drawHero(
		ctx,
		palette,
		count(snapshot.days.length),
		snapshot.days.length === 1 ? 'day written on' : 'days written on',
		540,
		190
	);

	drawHeatmap(ctx, snapshot, palette, 700);

	let y = 990;
	drawStatLine(ctx, palette, 'Longest run', plural(snapshot.longest.days, 'day'), y);
	y += 96;
	if (snapshot.current.days > 0) {
		drawStatLine(ctx, palette, 'Running right now', plural(snapshot.current.days, 'day'), y);
	} else if (snapshot.stats.records.lastMessageAt) {
		drawStatLine(ctx, palette, 'Last wrote', dateLabel(snapshot.stats.records.lastMessageAt), y);
	}
	y += 96;
	if (snapshot.busiest) {
		drawStatLine(
			ctx,
			palette,
			`Busiest day, ${dayLabel(snapshot.busiest.key)}`,
			plural(snapshot.busiest.count, 'message'),
			y
		);
	}

	drawHours(ctx, palette, snapshot);
}

/** The same rules the panel's clock draws by: bars scaled against the busiest hour, quiet
 *  hours kept on screen as the empty bars they are, the prime window lit. */
function drawHours(ctx: CanvasRenderingContext2D, palette: Palette, snapshot: StatsSnapshot): void {
	const prime = snapshot.prime;
	if (prime) {
		ctx.fillStyle = palette.secondary;
		ctx.font = `500 36px ${palette.sans}`;
		ctx.fillText(
			`Half of it lands between ${hourLabel(prime[0])} and ${hourLabel((prime[1] + 1) % 24)}.`,
			PAD,
			1320
		);
	}

	const hours = snapshot.hours;
	const peak = Math.max(1, ...hours);
	const gap = 8;
	const barWidth = (INNER - gap * 23) / 24;
	const base = 1660;
	const tall = 280;
	const quiet = mix(palette.surface, palette.accent, 0.3);
	const lit = (hour: number): boolean =>
		!prime ? false : prime[0] <= prime[1] ? hour >= prime[0] && hour <= prime[1] : hour >= prime[0] || hour <= prime[1];

	hours.forEach((value, hour) => {
		const height = Math.max(value > 0 ? 10 : 4, (value / peak) * tall);
		ctx.fillStyle = lit(hour) ? palette.accent : quiet;
		roundedRect(ctx, PAD + hour * (barWidth + gap), base - height, barWidth, height, 6);
		ctx.fill();
	});

	ctx.fillStyle = palette.muted;
	ctx.font = `400 26px ${palette.sans}`;
	['00:00', '06:00', '12:00', '18:00', '24:00'].forEach((tick, i) => {
		ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
		ctx.fillText(tick, PAD + (INNER / 4) * i, base + 46);
	});
	ctx.textAlign = 'left';
}

/** For the record: the superlatives, one leading the page and the rest in a grid. */
function drawRecords(ctx: CanvasRenderingContext2D, palette: Palette, snapshot: StatsSnapshot): void {
	drawEyebrow(ctx, palette, 'FOR THE RECORD', 216);

	const [lead, ...rest] = recordEntries(snapshot);

	ctx.fillStyle = palette.text;
	fitFont(ctx, lead.value, INNER, 170, 700, palette.serif);
	ctx.fillText(lead.value, PAD, 500);

	ctx.fillStyle = palette.secondary;
	ctx.font = `500 36px ${palette.sans}`;
	wrap(ctx, lead.label, INNER).forEach((line, i) => {
		ctx.fillText(line, PAD, 566 + i * 48);
	});

	const gap = 48;
	const column = (INNER - gap) / 2;
	rest.slice(0, 4).forEach((entry, i) => {
		const x = PAD + (i % 2) * (column + gap);
		const y = 780 + Math.floor(i / 2) * 340;

		ctx.strokeStyle = palette.border;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + column, y);
		ctx.stroke();

		ctx.fillStyle = palette.text;
		fitFont(ctx, entry.value, column, 110, 700, palette.serif);
		ctx.fillText(entry.value, x, y + 140);

		ctx.fillStyle = palette.muted;
		ctx.font = `400 30px ${palette.sans}`;
		wrap(ctx, entry.label, column).slice(0, 3).forEach((line, l) => {
			ctx.fillText(line, x, y + 196 + l * 40);
		});
	});

	if (snapshot.stats.records.firstMessageAt !== null) {
		drawStatLine(ctx, palette, 'First words here', dateLabel(snapshot.stats.records.firstMessageAt), 1580);
	}
}

/** The same grid the panel draws, at card scale and with the same four steps scaled against
 *  a busy day rather than the busiest one. A picture cannot be scrolled, so it takes the most
 *  recent stretch that fits and says underneath which stretch that was. */
function drawHeatmap(ctx: CanvasRenderingContext2D, snapshot: StatsSnapshot, palette: Palette, y: number): void {
	const days = snapshot.days;
	const cell = 13;
	const gap = 3;
	const step = cell + gap;

	const today = startOfLocalDay(snapshot.takenAt);
	const lastWeek = startOfWeek(today);
	let firstWeek = lastWeek;
	for (let i = 0; i < Math.min(53, Math.floor((INNER + gap) / step)) - 1; i++) {
		firstWeek = startOfWeek(firstWeek - 1);
	}
	// A library younger than the grid starts where the reader did, not in a year of grey.
	if (days.length && days[0].at > firstWeek) firstWeek = startOfWeek(days[0].at);

	// Week starts, stepped a day at a time so the hour a clock change costs cannot slide a
	// column. Counted before drawing, because the band is centred on however many there are.
	const columns: number[] = [];
	for (let cursor = firstWeek; cursor <= lastWeek; ) {
		columns.push(cursor);
		for (let i = 0; i < 7; i++) cursor = nextLocalDay(cursor);
	}
	const x = Math.round((POSTER_WIDTH - (columns.length * step - gap)) / 2);

	const byDay = new Map(days.map((d) => [d.at, d.count]));
	const sorted = days.map((d) => d.count).sort((a, b) => a - b);
	const ceiling = sorted.length
		? Math.max(1, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))])
		: 1;

	const steps = [
		mix(palette.surface, palette.accent, 0.28),
		mix(palette.surface, palette.accent, 0.52),
		mix(palette.surface, palette.accent, 0.76),
		palette.accent
	];

	columns.forEach((column, w) => {
		let day = column;
		for (let d = 0; d < 7; d++) {
			if (day <= today) {
				const value = byDay.get(day) ?? 0;
				ctx.fillStyle = value
					? steps[Math.min(3, Math.max(0, Math.ceil((value / ceiling) * 4) - 1))]
					: palette.surface;
				roundedRect(ctx, x + w * step, y + d * step, cell, cell, 3);
				ctx.fill();
			}
			day = nextLocalDay(day);
		}
	});

	ctx.fillStyle = palette.muted;
	ctx.font = `400 26px ${palette.sans}`;
	ctx.textAlign = 'center';
	ctx.fillText(`${monthYearLabel(firstWeek)} to ${monthYearLabel(today)}`, POSTER_WIDTH / 2, y + 7 * step + 40);
	ctx.textAlign = 'left';
}
