/**
 * Regenerate every raster icon from static/icon.svg, the raccoon's head.
 *
 * static/ holds two drawings and only this one is rendered here. `mark.svg` is the whole
 * animal and the app links it as a vector, so it needs no rasters; `icon.svg` is the head,
 * and it is what every icon is cut from because below about 48px the full body loses its
 * face and reads as a pale smudge, while the head still shows two eyes at 16. A tab, a
 * taskbar and a home screen are all in that range. The head carries the same three colours
 * as the body, and it is drawn to touch its box left and right, so nothing here needs to
 * scale or recolour it.
 *
 * Nothing here is hand-drawn: the .ico, the manifest PNGs, the two plated tiles and the
 * docs logo are all renders. Run this after editing the head, and commit what it writes:
 * the outputs are served and shipped, not built on demand.
 *
 * Needs ImageMagick (`magick`) with an SVG renderer on PATH. It is a workstation tool,
 * never a runtime or build dependency: the app and the portable package read the files
 * this leaves behind.
 *
 * Run: bun run icons
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const iconSvg = join(root, 'static', 'icon.svg');
const iconDir = join(root, 'static', 'icons');

/** The plate under the two tiles a platform paints on its own background. */
const PLATE = '#131417';
/* Android crops a maskable icon to its launcher's shape, so the art has to fit the safe
   circle: 80% of the tile across, i.e. 40% from the centre. This number is measured, not
   picked: the drawing's furthest ink is an ear tip, 56% of its box out from the centre, and
   0.4 / 0.56 is how large it can be scaled and still land inside.
   Redraw icon.svg and this has to be measured again, or a launcher that crops hard takes a
   bite out of it. */
const MASKABLE_ART = 0.71;
/* iOS clips corners with a squircle rather than a circle and composites transparency on
   black, so this tile needs a plate but far less inset: at this scale the ink reaches 48%
   of the tile from its centre, nowhere near the corners that get cut. */
const APPLE_ART = 0.86;

function magick(args: string[]): void {
	const p = Bun.spawnSync(['magick', ...args], { stdout: 'inherit', stderr: 'inherit' });
	if (p.exitCode !== 0) throw new Error(`magick ${args.join(' ')} failed (exit ${p.exitCode})`);
}

// Spawning a binary that is not there throws rather than returning a code, so the check
// has to catch as well as test, or the run ends on Bun's message instead of this one.
let magickReady = false;
try {
	magickReady =
		Bun.spawnSync(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
} catch {
	magickReady = false;
}
if (!magickReady) {
	throw new Error('ImageMagick (`magick`) is not on PATH. Install it, or generate the icons elsewhere');
}

mkdirSync(iconDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'chungus-icons-'));

try {
	// One high-resolution master, downsampled per target: rendering the SVG straight to
	// 16px loses the thin strokes that a downsample keeps as grey.
	const head = join(tmp, 'head.png');
	magick(['-background', 'none', iconSvg, '-resize', '1024x1024', '-depth', '8', head]);

	// Every write is 8-bit and stripped: the renderer works in 16-bit, which triples the
	// weight of a two-tone drawing for precision no screen can show.
	const flat = (px: number, out: string) =>
		magick([head, '-filter', 'Lanczos', '-resize', `${px}x${px}`, '-depth', '8', '-strip', out]);

	/** The head centred on an opaque plate, for the platforms that crop or blacken. */
	const plated = (px: number, art: number, out: string) =>
		magick([
			head,
			'-filter', 'Lanczos',
			'-resize', `${Math.round(512 * art)}x${Math.round(512 * art)}`,
			'-background', PLATE,
			'-gravity', 'center',
			'-extent', '512x512',
			'-alpha', 'remove',
			'-alpha', 'off',
			'-resize', `${px}x${px}`,
			'-depth', '8',
			'-strip',
			out
		]);

	flat(192, join(iconDir, 'icon-192.png'));
	flat(512, join(iconDir, 'icon-512.png'));
	plated(512, MASKABLE_ART, join(iconDir, 'icon-maskable-512.png'));
	plated(180, APPLE_ART, join(iconDir, 'apple-touch-icon-180.png'));

	// The .ico carries its own copy of every size it serves. Each one is downsampled from
	// the master rather than from the next size up, so 16px is not a blur of a blur. Only
	// the 256 is stored as PNG; the rest are raw bitmaps, which is why the list stops at
	// the four sizes something actually asks for (tab and taskbar, Explorer's largest):
	// a 128 entry alone would cost more than the whole file does.
	const icoSizes = [256, 48, 32, 16];
	const icoParts = icoSizes.map((px) => {
		const part = join(tmp, `ico-${px}.png`);
		flat(px, part);
		return part;
	});
	magick([...icoParts, join(root, 'static', 'favicon.ico')]);

	// The one copy outside the app: the docs site puts its logo in a navbar and reuses it
	// as a favicon, both icon-sized, so that is the head too. The README's banner is drawn
	// by hand and is not generated by anything.
	flat(512, join(root, 'docs', 'logo', 'mascot.png'));

	console.log('Icons regenerated from static/icon.svg');
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
