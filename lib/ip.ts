export function parseIp(input: string): Uint8Array | null {
	const s = input.trim();
	if (s.length === 0 || s.length > 45) return null;
	return s.includes(':') ? parseV6(s) : parseV4(s);
}

export function maskBytes(bytes: Uint8Array, bits: number): Uint8Array {
	const out = new Uint8Array(bytes.length);
	const full = Math.min(Math.max(Math.floor(bits / 8), 0), bytes.length);
	const rem = bits % 8;
	for (let i = 0; i < full; i++) out[i] = bytes[i];

	if (rem > 0 && full < bytes.length) out[full] = bytes[full] & ((0xff << (8 - rem)) & 0xff);
	return out;
}

export function formatBytes(bytes: Uint8Array): string {
	if (bytes.length === 4) return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
	const parts: string[] = [];
	for (let i = 0; i < 8; i++) parts.push((((bytes[i * 2] << 8) | bytes[i * 2 + 1]) >>> 0).toString(16));
	return parts.join(':');
}

export function networkKey(bytes: Uint8Array, v4Bits: number, v6Bits: number): string {
	return formatBytes(maskBytes(bytes, bytes.length === 4 ? v4Bits : v6Bits));
}

function parseV4(s: string): Uint8Array | null {
	const parts = s.split('.');
	if (parts.length !== 4) return null;
	const out = new Uint8Array(4);
	for (let i = 0; i < 4; i++) {
		const p = parts[i];
		if (!/^\d{1,3}$/.test(p)) return null;
		if (p.length > 1 && p[0] === '0') return null;
		const n = Number(p);
		if (n > 255) return null;
		out[i] = n;
	}
	return out;
}

function parseV6(input: string): Uint8Array | null {
	const pct = input.indexOf('%');
	const s = pct === -1 ? input : input.slice(0, pct);
	const halves = s.split('::');
	if (halves.length > 2) return null;

	const head = groups(halves[0]);
	if (head === null) return null;

	let list: number[];
	if (halves.length === 2) {
		const tail = groups(halves[1]);
		if (tail === null) return null;
		if (head.length + tail.length > 7) return null;
		list = [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail];
	} else {
		list = head;
	}
	if (list.length !== 8) return null;

	const out = new Uint8Array(16);
	for (let i = 0; i < 8; i++) {
		out[i * 2] = (list[i] >>> 8) & 0xff;
		out[i * 2 + 1] = list[i] & 0xff;
	}
	return out;
}

function groups(part: string): number[] | null {
	if (part === '') return [];
	const items = part.split(':');
	const out: number[] = [];
	for (let i = 0; i < items.length; i++) {
		const g = items[i];
		if (g.includes('.')) {
			if (i !== items.length - 1) return null;
			const v4 = parseV4(g);
			if (!v4) return null;
			out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
			continue;
		}
		if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
		out.push(parseInt(g, 16));
	}
	return out;
}
