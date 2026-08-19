import { describe, expect, test } from 'bun:test';
import { createZip } from './zip';
import { crc32 } from './crc32';

/** Walk the STORE-method archive back into {name, data, crc} entries + the EOCD summary. */
function parseZip(zip: Uint8Array) {
	const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const dec = new TextDecoder();
	const files: { name: string; data: Uint8Array; crc: number }[] = [];
	let off = 0;
	while (off + 4 <= zip.length && dv.getUint32(off, true) === 0x04034b50) {
		const crc = dv.getUint32(off + 14, true);
		const compSize = dv.getUint32(off + 18, true);
		const nameLen = dv.getUint16(off + 26, true);
		const extraLen = dv.getUint16(off + 28, true);
		const name = dec.decode(zip.subarray(off + 30, off + 30 + nameLen));
		const dataStart = off + 30 + nameLen + extraLen;
		const data = zip.subarray(dataStart, dataStart + compSize);
		files.push({ name, data, crc });
		off = dataStart + compSize;
	}
	const eocdOff = zip.length - 22;
	return {
		files,
		eocdSig: dv.getUint32(eocdOff, true),
		total: dv.getUint16(eocdOff + 10, true),
		centralSig: dv.getUint32(off, true)
	};
}

describe('ZIP writer (STORE)', () => {
	test('stores entries verbatim with a valid structure and CRCs', async () => {
		const a = new TextEncoder().encode('hello world');
		const b = new Uint8Array([0, 1, 2, 250, 255, 128]);
		const zip = new Uint8Array(await createZip([{ name: 'a.txt', data: a }, { name: 'b.bin', data: b }]).arrayBuffer());

		const { files, eocdSig, total, centralSig } = parseZip(zip);
		expect(eocdSig).toBe(0x06054b50);
		expect(centralSig).toBe(0x02014b50); // central directory follows the last entry's data
		expect(total).toBe(2);
		expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.bin']);
		// STORE = byte-for-byte, no compression.
		expect(Array.from(files[0].data)).toEqual(Array.from(a));
		expect(Array.from(files[1].data)).toEqual(Array.from(b));
		// The header CRC must match the data: a mismatch makes real unzip tools reject the entry.
		expect(files[0].crc).toBe(crc32(a));
		expect(files[1].crc).toBe(crc32(b));
	});

	test('an empty archive is just the end-of-central-directory record', async () => {
		const zip = new Uint8Array(await createZip([]).arrayBuffer());
		expect(zip.length).toBe(22);
		expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x06054b50);
	});
});
