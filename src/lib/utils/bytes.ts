/**
 * The app's one file-size wording. Sizes here are read at a glance and never computed
 * against, so one decimal is the ceiling: a folder reported to the byte is a number nobody
 * finishes reading, and two surfaces spelling the same folder differently reads as a fault.
 */
export function bytes(n: number): string {
	if (n <= 0) return '0 MB';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = n;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 && unit > 1 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
