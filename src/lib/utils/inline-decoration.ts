/**
 * The inline style allowlist for model output.
 *
 * A preset is a document you downloaded from a stranger. Its regex rules rewrite the reply
 * before you read it, so whatever CSS they smuggle in is CSS you did not write, sitting
 * inside your app, over your data. The whole risk model follows from that one sentence:
 * the danger is not the model, it is the preset.
 *
 * So a preset may DECORATE its own box and may not do anything else. Four properties, all
 * of them pure surface:
 *
 *   color · background-color · font-weight · text-align
 *
 * Everything the app itself owns stays the app's: size, spacing, corners, borders,
 * shadows, fonts, and above all POSITION. Without width, height, position, margin,
 * transform or z-index there is no way to lift a block out of the transcript and paint a
 * convincing fake window over the interface. That is the attack that matters, because a
 * fake window can ask for an API key and a real one never would. Nothing here can load an
 * external resource either, so a rule cannot phone home by asking for a background image.
 *
 * THIS LIST MUST NOT GROW. Adding a size or a position re-opens exactly the door the four
 * properties above were chosen to keep shut, and the boundary stops meaning anything.
 */

/** The four. Not a starting point but the whole set. */
const DECORATION_PROPERTIES = new Set(['color', 'background-color', 'font-weight', 'text-align']);

/**
 * A colour and nothing that merely looks like one. Hex, an rgb/hsl function whose argument
 * list cannot itself contain a parenthesis (so no nested `var()`, `url()` or `image-set()`
 * can hide inside), or a bare keyword. A keyword the browser doesn't know is simply
 * ignored by the browser, which is why matching letters is enough here.
 */
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9a-z.,%\s/+-]+\)|[a-z]+)$/i;
const WEIGHT_VALUE = /^(?:normal|bold|lighter|bolder|[1-9]00)$/i;
const ALIGN_VALUE = /^(?:left|right|center|justify|start|end)$/i;

function isAllowedValue(property: string, value: string): boolean {
	switch (property) {
		case 'color':
		case 'background-color':
			return COLOR_VALUE.test(value);
		case 'font-weight':
			return WEIGHT_VALUE.test(value);
		case 'text-align':
			return ALIGN_VALUE.test(value);
		default:
			return false;
	}
}

/** True for a value that is a colour on its own, used for the legacy `<font color>`. */
export function isDecorationColor(value: string): boolean {
	return COLOR_VALUE.test(value.trim());
}

/**
 * Reduce a `style` attribute to the declarations above, re-serialized from what survived.
 * The output is built here rather than edited in place, so anything unparsed (a stray
 * brace, a comment, a second attribute smuggled through a quote) cannot reach the DOM.
 * Returns an empty string when nothing survives, which the caller reads as "drop it".
 */
export function sanitizeDecorations(style: string): string {
	const kept: string[] = [];
	for (const declaration of style.split(';')) {
		const colon = declaration.indexOf(':');
		if (colon === -1) continue;
		const property = declaration.slice(0, colon).trim().toLowerCase();
		if (!DECORATION_PROPERTIES.has(property)) continue;
		// `!important` would let a preset out-rank the app's own rules on the same
		// property. It changes nothing about what is allowed, so it is simply dropped.
		const value = declaration.slice(colon + 1).replace(/!\s*important/gi, '').trim();
		if (!value || !isAllowedValue(property, value)) continue;
		kept.push(`${property}: ${value}`);
	}
	return kept.join('; ');
}
