/**
 * WCAG contrast over the plain hexes a palette is made of.
 *
 * The palette editor is the one place in the app where a reader can build something
 * illegible, so it is the one place that has to measure. Everything downstream of a
 * palette is derived (`applyTheme()` mixes the tiers, the borders and the inks out of
 * these same colors), which is what makes checking the source pairs meaningful rather
 * than a spot check: get ink against surface right and the seventy-odd properties minted
 * from them follow.
 *
 * Hex only, deliberately. A palette stores nothing else, and a parser that also accepted
 * `color-mix(…)` would be a second, worse copy of the browser's own color engine.
 */

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/** WCAG relative luminance. sRGB channels, linearised, weighted for the eye. */
function luminance(hex: string): number {
	const m = HEX_RE.exec(hex);
	if (!m) throw new Error(`[contrast] "${hex}" is not a #rrggbb hex`);
	const channel = (i: number): number => {
		const v = parseInt(m[1].slice(i * 2, i * 2 + 2), 16) / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Contrast ratio between two hexes, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * How a measured pair reads against the floor it is held to.
 *
 * `tight` is not a softened failure: it is the band where text is legible at a large
 * size and not at a small one, which is exactly the judgement a reader building a
 * palette needs to make for themselves. Anything below it is called what it is.
 */
export type ContrastVerdict = 'pass' | 'tight' | 'fail';

export function contrastVerdict(ratio: number, floor: number): ContrastVerdict {
	if (ratio >= floor) return 'pass';
	return ratio >= 3 ? 'tight' : 'fail';
}

/** One line in the editor's readout: what sits on what, and the floor it owes. */
export interface ContrastCheck {
	label: string;
	ink: string;
	surface: string;
	/** 4.5 for anything read at body size, 3 for supporting text and large type. */
	floor: number;
}

export interface ContrastReading extends ContrastCheck {
	ratio: number;
	verdict: ContrastVerdict;
}

export function readContrast(check: ContrastCheck): ContrastReading {
	const ratio = contrastRatio(check.ink, check.surface);
	return { ...check, ratio, verdict: contrastVerdict(ratio, check.floor) };
}
