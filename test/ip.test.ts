import { describe, expect, test } from 'bun:test';
import { formatBytes, maskBytes, networkKey, parseIp } from '../lib/ip.ts';

describe('parseIp', () => {
	test('accepts valid IPv4', () => {
		expect(Array.from(parseIp('1.2.3.4')!)).toEqual([1, 2, 3, 4]);
		expect(Array.from(parseIp('255.255.255.255')!)).toEqual([255, 255, 255, 255]);
		expect(Array.from(parseIp('0.0.0.0')!)).toEqual([0, 0, 0, 0]);
	});

	test('rejects malformed IPv4', () => {
		for (const bad of ['1.2.3', '1.2.3.4.5', '', ' ', 'a.b.c.d', '256.1.1.1', '1.2.3.-4', '1.2.3.4:80']) {
			expect(parseIp(bad)).toBeNull();
		}
	});

	test('rejects IPv4 with leading zeros', () => {
		expect(parseIp('010.1.1.1')).toBeNull();
		expect(parseIp('1.1.1.01')).toBeNull();
	});

	test('accepts valid IPv6', () => {
		expect(formatBytes(parseIp('::1')!)).toBe('0:0:0:0:0:0:0:1');
		expect(formatBytes(parseIp('2001:db8::1')!)).toBe('2001:db8:0:0:0:0:0:1');
		expect(formatBytes(parseIp('2001:0db8:0000:0000:0000:0000:0000:0001')!)).toBe('2001:db8:0:0:0:0:0:1');
		expect(formatBytes(parseIp('::')!)).toBe('0:0:0:0:0:0:0:0');
	});

	test('accepts IPv6 with an embedded IPv4 tail', () => {
		expect(formatBytes(parseIp('::ffff:192.168.0.1')!)).toBe('0:0:0:0:0:ffff:c0a8:1');
	});

	test('rejects malformed IPv6', () => {
		for (const bad of [':::', '2001:db8::1::2', '2001:db8::gggg', '1:2:3:4:5:6:7:8:9']) {
			expect(parseIp(bad)).toBeNull();
		}
	});
});

describe('maskBytes', () => {
	test('masks to the requested prefix', () => {
		const bytes = parseIp('175.144.151.253')!;
		expect(formatBytes(maskBytes(bytes, 24))).toBe('175.144.151.0');
		expect(formatBytes(maskBytes(bytes, 16))).toBe('175.144.0.0');
		expect(formatBytes(maskBytes(bytes, 32))).toBe('175.144.151.253');
	});

	test('masks a partial byte correctly', () => {
		expect(formatBytes(maskBytes(parseIp('175.144.151.253')!, 20))).toBe('175.144.144.0');

		expect(formatBytes(maskBytes(parseIp('10.0.0.200')!, 25))).toBe('10.0.0.128');
	});

	test('masks IPv6 to /48', () => {
		expect(formatBytes(maskBytes(parseIp('2001:4860:4860::8888')!, 48))).toBe('2001:4860:4860:0:0:0:0:0');
		expect(formatBytes(maskBytes(parseIp('2001:4860:4860::8888')!, 128))).toBe('2001:4860:4860:0:0:0:0:8888');
	});

	test('does not mutate the input', () => {
		const bytes = parseIp('1.2.3.4')!;
		maskBytes(bytes, 24);
		expect(formatBytes(bytes)).toBe('1.2.3.4');
	});
});

describe('networkKey', () => {
	test('groups addresses in the same /24', () => {
		const a = networkKey(parseIp('175.144.151.253')!, 24, 48);
		const b = networkKey(parseIp('175.144.151.9')!, 24, 48);
		expect(a).toBe(b);
		expect(a).toBe('175.144.151.0');
	});

	test('separates different /24s', () => {
		expect(networkKey(parseIp('175.144.151.1')!, 24, 48)).not.toBe(networkKey(parseIp('175.144.152.1')!, 24, 48));
	});

	test('honours a per-IP setting', () => {
		expect(networkKey(parseIp('175.144.151.1')!, 32, 128)).toBe('175.144.151.1');
	});
});
