/**
 * Minimal line-level diff for the compare view.
 *
 * A real LCS diff (not a set-difference fudge) so the panel shows the true edits
 * between two prompts. Capped for very large inputs to keep a manual compare snappy.
 */
export type DiffOp = { type: 'same' | 'add' | 'remove'; text: string };

/** Past this many lines on either side the LCS is abandoned for a whole-block diff. The
 *  caller reads it to LABEL that fallback: a coarse diff reports every line as changed,
 *  and passing that off as the real edit set would be a lie about what actually differs. */
export const DIFF_LINE_CAP = 2000;

export function lineDiff(a: string, b: string): DiffOp[] {
	const aLines = a.split('\n');
	const bLines = b.split('\n');

	// Bail to a coarse whole-block diff if either side is huge: LCS is O(n*m).
	if (aLines.length > DIFF_LINE_CAP || bLines.length > DIFF_LINE_CAP) {
		return [
			...aLines.map((text) => ({ type: 'remove' as const, text })),
			...bLines.map((text) => ({ type: 'add' as const, text }))
		];
	}

	const n = aLines.length;
	const m = bLines.length;
	// dp[i][j] = LCS length of aLines[i:] and bLines[j:].
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (aLines[i] === bLines[j]) {
			ops.push({ type: 'same', text: aLines[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ type: 'remove', text: aLines[i] });
			i++;
		} else {
			ops.push({ type: 'add', text: bLines[j] });
			j++;
		}
	}
	while (i < n) ops.push({ type: 'remove', text: aLines[i++] });
	while (j < m) ops.push({ type: 'add', text: bLines[j++] });
	return ops;
}
