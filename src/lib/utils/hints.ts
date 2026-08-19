/**
 * Hint labels: the badges drawn over the controls on screen so one can be picked by name
 * instead of by aim.
 *
 * A cursor that steps is the wrong tool for a far target and a pointer driven by arrow keys
 * is a slow mouse; what the keyboard has over both is that it can ADDRESS a thing. So every
 * control gets a short name for as long as the labels are up, and typing it presses that
 * control.
 *
 * **Every label is the same length**, which is what makes them prefix-free: a one-character
 * label that is also the start of a two-character one could never be typed, since the first
 * press would have to guess whether the reader was finished. Same length also means the
 * reader learns a fixed rhythm instead of watching for when a label ends.
 */

/** Home row, so a label is typed without the hand moving. */
export const HINT_ALPHABET = 'asdfghjkl';

/**
 * Labels for `count` targets, in the order the targets are drawn.
 *
 * Odometer order over the alphabet at the shortest length that covers the count, so the
 * labels for a screen of nine controls are single letters and the same screen with one more
 * is entirely pairs. A screen never mixes the two.
 */
export function hintLabels(count: number, alphabet: string = HINT_ALPHABET): string[] {
	if (count <= 0) return [];
	// One character can never name a second target, and the loop below would not terminate.
	if (alphabet.length < 2) throw new Error('hintLabels needs an alphabet of at least two characters');
	let length = 1;
	while (alphabet.length ** length < count) length += 1;
	const labels: string[] = [];
	for (let index = 0; index < count; index += 1) {
		let label = '';
		let remaining = index;
		for (let position = 0; position < length; position += 1) {
			label = alphabet[remaining % alphabet.length] + label;
			remaining = Math.floor(remaining / alphabet.length);
		}
		labels.push(label);
	}
	return labels;
}
