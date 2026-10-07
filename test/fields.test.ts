import { describe, expect, test } from 'bun:test';
import { DEFAULT_FIELDS, FIELDS, PROXY_FLAGS } from '../lib/fields.ts';

const KEYS = FIELDS.map((f) => f.key);

describe('field catalogue', () => {
	test('the default set covers every declared field', () => {
		expect([...KEYS, 'proxy_flags'].filter((key) => !DEFAULT_FIELDS.includes(key))).toEqual([]);
	});

	test('declares no duplicate keys or headers', () => {
		expect(new Set(KEYS).size).toBe(KEYS.length);
		const headers = FIELDS.map((f) => f.header);
		expect(new Set(headers).size).toBe(headers.length);
	});

	test('every proxy flag points at a declared field path', () => {
		const paths = new Set(FIELDS.map((f) => f.path));
		expect(PROXY_FLAGS.filter((f) => !paths.has(f.path))).toEqual([]);
	});
});
