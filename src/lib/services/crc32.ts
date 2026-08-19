/**
 * Standard CRC-32 (polynomial 0xEDB88320), the checksum PNG chunks and ZIP entries both
 * use. Shared so the PNG card writer (`sillyTavernExport.ts`) and the ZIP writer (`zip.ts`)
 * compute it the same way.
 */

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
	if (crcTable) return crcTable;
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	crcTable = table;
	return table;
}

/** CRC-32 over a byte range. */
export function crc32(bytes: Uint8Array): number {
	const table = getCrcTable();
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
