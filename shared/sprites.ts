/**
 * The sprite rules both halves of the app write through.
 *
 * Three doors put a pack of pictures on a character: the editor's Sprites upload, the
 * SillyTavern folder import, and the example character the server seeds on first boot. The
 * first two are client code and the third is not, so these live here rather than in
 * `$lib/utils/sprites.ts`, which re-exports them. A second copy would let the same pack label
 * itself two ways, or leave a character holding sprites with no default, depending on which
 * way in it took.
 */

/** Collapse whitespace and drop the surrounding blanks. Labels keep their own casing. */
export function normalizeSpriteLabel(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ');
}

/** The label a picture's own filename carries: `quiet_anger.png` → "quiet anger". */
export function labelFromFilename(name: string): string {
	return normalizeSpriteLabel(name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
}

/**
 * The default sprite an entry should be left with: the current one while it still names a
 * sprite, otherwise the first sprite there is, otherwise none.
 *
 * A character with sprites ALWAYS has a default, which is what lets the chat draw something the
 * instant the engine is switched on. Every write that can move the sprite list runs its result
 * through here: the pointer is kept true at write time and never repaired at read time, so a
 * default naming nothing would be a bug and not a state readers handle.
 *
 * Structurally typed rather than tied to `CharacterSprite`, which lives in the client's own
 * types and cannot be reached from here.
 */
export function resolveDefaultSprite(
	sprites: { path: string }[],
	current: string | undefined
): string | undefined {
	if (current && sprites.some((s) => s.path === current)) return current;
	return sprites[0]?.path;
}
