/**
 * On-demand loader for the bundled font families in static/fonts/.
 *
 * app.html links only the default families (Newsreader, Manrope, JetBrains
 * Mono). Alternative body/UI fonts load here the first time the user picks
 * one, so nobody pays for fonts they never use. Everything is served from
 * this origin, with no network dependency. Each family injects one stylesheet
 * <link>; failures degrade silently to the stack's fallback fonts.
 */
const loaded = new Set<string>();

export function ensureFontLoaded(bundledFont: string | undefined): void {
	if (!bundledFont || loaded.has(bundledFont) || typeof document === 'undefined') return;
	loaded.add(bundledFont);
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = `/fonts/${bundledFont}.css`;
	document.head.appendChild(link);
}
