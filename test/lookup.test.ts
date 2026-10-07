import { describe, expect, test } from 'bun:test';
import { lookupIp } from '../lib/lookup.ts';
import type { LookupOptions } from '../lib/lookup.ts';
import { MemoryCache } from '../lib/memory-cache.ts';
import { MY_PAYLOAD, VPN_PAYLOAD, jsonResponse, recordingFetch } from './helpers.ts';

const OPTS: LookupOptions = { ttl: 3600 };

function harness(reply: Parameters<typeof recordingFetch>[0], options: Partial<LookupOptions> = {}, cache = new MemoryCache()) {
	const fetcher = recordingFetch(reply);
	return {
		fetcher,
		cache,
		run: (ip: string, opts: Partial<LookupOptions> = {}) => lookupIp(ip, { ...OPTS, ...options, ...opts }, { fetch: fetcher.fetch, apiKey: 'TESTKEY', cache }),
	};
}

describe('lookupIp', () => {
	test('queries the API with the address and key', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		const result = await h.run('175.144.151.253');

		expect(result.status).toBe('miss');
		expect(result.data?.isp).toBe('Telekom Malaysia Berhad');
		const url = new URL(h.fetcher.calls[0]!);
		expect(url.origin + url.pathname).toBe('https://api.ip2location.io/');
		expect(url.searchParams.get('ip')).toBe('175.144.151.253');
		expect(url.searchParams.get('key')).toBe('TESTKEY');
		expect(url.searchParams.get('format')).toBe('json');
	});

	test('serves the second identical lookup from cache', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.253');
		const second = await h.run('175.144.151.253');

		expect(second.status).toBe('hit');
		expect(h.fetcher.calls.length).toBe(1);
	});

	test('serves another address in the same /24 from cache', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.253');
		const second = await h.run('175.144.151.9');

		expect(second.status).toBe('hit');
		expect(h.fetcher.calls.length).toBe(1);
	});

	test('does not share a cache entry across /24 boundaries', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.1');
		await h.run('175.144.152.1');
		expect(h.fetcher.calls.length).toBe(2);
	});

	test('keys the cache by network, not by address', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.253');
		expect(h.cache.get('175.144.151.0')).resolves.toBeDefined();
	});

	test('never caches the per-request ip field or the lookup timestamp', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.253');

		const cached = (await h.cache.get('175.144.151.0')) as Record<string, any>;
		expect(cached.ip).toBeUndefined();
		expect(cached.time_zone_info.current_time).toBeUndefined();

		expect(cached.time_zone_info.abbreviation).toBe('MYT');
		expect(cached.continent.code).toBe('AS');
	});

	test('reports a 200 carrying an error object as a failure', async () => {
		const h = harness(() => jsonResponse({ error: { error_code: 10001, error_message: 'Invalid IP address.' } }));
		const result = await h.run('175.144.151.253');

		expect(result.status).toBe('error');
		expect(result.data).toBeNull();
		expect(result.error).toBe('10001: Invalid IP address.');
	});

	test('falls back to the keyless lane when the quota is exhausted', async () => {
		const h = harness((url) => (url.includes('key=') ? jsonResponse({ error: { error_code: 10000, error_message: 'Invalid API key or insufficient query.' } }) : jsonResponse(MY_PAYLOAD)));
		const result = await h.run('175.144.151.253');

		expect(result.data?.isp).toBe('Telekom Malaysia Berhad');
		expect(h.fetcher.calls.length).toBe(2);
		expect(new URL(h.fetcher.calls[1]!).searchParams.get('key')).toBeNull();
	});

	test('does not retry keyless when no key was configured', async () => {
		const fetcher = recordingFetch(() => jsonResponse({ error: { error_code: 10000, error_message: 'quota' } }));
		const result = await lookupIp('175.144.151.253', OPTS, { fetch: fetcher.fetch, apiKey: '', cache: new MemoryCache() });

		expect(result.status).toBe('error');
		expect(fetcher.calls.length).toBe(1);
	});

	test('does not retry keyless on an unrelated error code', async () => {
		const fetcher = recordingFetch(() => jsonResponse({ error: { error_code: 10002, error_message: 'Internal server error.' } }));
		await lookupIp('175.144.151.253', OPTS, { fetch: fetcher.fetch, apiKey: 'TESTKEY', cache: new MemoryCache() });
		expect(fetcher.calls.length).toBe(1);
	});

	test('treats an HTTP failure as an error, not as data', async () => {
		const h = harness(() => new Response('nope', { status: 500 }));
		expect((await h.run('175.144.151.253')).status).toBe('error');
	});

	test('survives a network exception', async () => {
		const fetcher = (async () => {
			throw new Error('connection reset');
		}) as unknown as typeof fetch;
		const result = await lookupIp('175.144.151.253', OPTS, { fetch: fetcher, apiKey: 'K', cache: new MemoryCache() });

		expect(result.status).toBe('error');
		expect(result.error).toContain('connection reset');
	});

	test('rejects an invalid address without spending a query', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		const result = await h.run('not-an-ip');

		expect(result.status).toBe('invalid');
		expect(h.fetcher.calls.length).toBe(0);
	});

	test('guards against a payload that is not a lookup result', async () => {
		const h = harness(() => jsonResponse({ hello: 'world' }));
		expect((await h.run('175.144.151.253')).status).toBe('error');
	});

	test('skips caching entirely when the TTL is 0', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD), { ttl: 0 });
		const first = await h.run('175.144.151.253');
		const second = await h.run('175.144.151.253');

		expect(first.status).toBe('off');
		expect(second.status).toBe('off');
		expect(h.cache.size).toBe(0);
		expect(h.fetcher.calls.length).toBe(2);
	});

	test('keeps security fields intact through the cache', async () => {
		const h = harness(() => jsonResponse(VPN_PAYLOAD));
		await h.run('102.129.143.3');
		const result = await h.run('102.129.143.9');

		expect(result.status).toBe('hit');
		expect((result.data?.proxy as Record<string, unknown>).is_vpn).toBe(true);
		expect(result.data?.fraud_score).toBe(99);
	});
});

describe('MemoryCache', () => {
	test('expires entries once the TTL passes', async () => {
		let clock = 1_000_000;
		const cache = new MemoryCache(10, () => clock);
		await cache.set('8.8.8.0', { country_code: 'US' }, 60);

		expect(await cache.get('8.8.8.0')).toEqual({ country_code: 'US' });
		clock += 59_000;
		expect(await cache.get('8.8.8.0')).toEqual({ country_code: 'US' });
		clock += 2_000;
		expect(await cache.get('8.8.8.0')).toBeUndefined();
	});

	test('evicts the least recently used entry past the cap', async () => {
		const cache = new MemoryCache(2);
		await cache.set('a', 1, 60);
		await cache.set('b', 2, 60);
		await cache.get('a');
		await cache.set('c', 3, 60);

		expect(cache.size).toBe(2);
		expect(await cache.get('a')).toBe(1);
		expect(await cache.get('b')).toBeUndefined();
		expect(await cache.get('c')).toBe(3);
	});

	test('starting empty, as a cold isolate would', async () => {
		const cache = new MemoryCache();
		expect(cache.size).toBe(0);
		expect(await cache.get('anything')).toBeUndefined();
	});
});
