import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryCache } from '../lib/memory-cache.ts';
import type { CacheLike, Env } from '../lib/types.ts';
import { createHandler } from '../netlify/edge-functions/ip2location-headers.ts';
import { MY_PAYLOAD, VPN_PAYLOAD, installFetch, jsonResponse, makeEnv } from './helpers.ts';

const P = 'X-IP2Location-';

const active: Array<() => void> = [];

afterEach(() => {
	while (active.length > 0) active.pop()!();
	delete (globalThis as { Netlify?: unknown }).Netlify;
});

interface Setup {
	api?: () => Response;
	origin?: () => Response;
	env?: Env;
	cache?: CacheLike;
}

function setup({ api, origin, env, cache }: Setup = {}) {
	const lane = installFetch({ api, origin });
	const handler = createHandler({ cache: cache ?? new MemoryCache() });

	(globalThis as { Netlify?: unknown }).Netlify = {
		env: { toObject: () => ({ ...makeEnv(), ...env }) },
	};
	active.push(lane.restore);

	return {
		lookups: lane.lookups,
		chained: lane.chained,
		context: lane.context,
		run: (url: string, init: RequestInit = {}, overrides = {}) => handler(new Request(url, init), lane.context(overrides)),
	};
}

describe('enrichment', () => {
	test('attaches the enrichment headers to the request handed down the chain', async () => {
		const s = setup();
		await s.run('https://shop.example.com/cart');

		const sent = s.chained[0]!;
		expect(sent.url).toBe('https://shop.example.com/cart');
		expect(sent.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');
		expect(sent.headers.get(P + 'Usage-Type')).toBe('ISP');
		expect(sent.headers.get(P + 'Country-Currency')).toBe('MYR');
		expect(sent.headers.get(P + 'Lookup')).toBe('miss');
		expect(sent.headers.get(P + 'Network')).toBeNull();
	});

	test('queries the API for context.ip', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');

		expect(s.lookups.length).toBe(1);
		expect(new URL(s.lookups[0]!).searchParams.get('ip')).toBe('175.144.151.253');
	});

	test('adds ASN and continent, which Netlify has no equivalent for', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');

		const sent = s.chained[0]!;
		expect(sent.headers.get(P + 'ASN')).toBe('4788');
		expect(sent.headers.get(P + 'AS-Name')).toBe('TM Technology Services Sdn. Bhd.');
		expect(sent.headers.get(P + 'Continent')).toBe('AS');
	});

	test('does not repeat what context.geo already resolves', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');

		const sent = s.chained[0]!;
		for (const name of ['Country', 'City', 'Region', 'Latitude', 'Longitude', 'Postal-Code', 'Timezone']) {
			expect(sent.headers.get(P + name)).toBeNull();
		}
	});

	test('preserves the method, body and unrelated headers', async () => {
		const s = setup();
		await s.run('https://shop.example.com/checkout', {
			method: 'POST',
			body: 'a=1',
			headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-custom': 'keep' },
		});

		const sent = s.chained[0]!;
		expect(sent.method).toBe('POST');
		expect(await sent.text()).toBe('a=1');
		expect(sent.headers.get('x-custom')).toBe('keep');
		expect(sent.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
	});

	test('returns the origin response untouched', async () => {
		const s = setup({ origin: () => new Response('hello', { status: 201, headers: { 'x-origin': 'yes' } }) });
		const res = await s.run('https://shop.example.com/');

		expect(res.status).toBe(201);
		expect(await res.text()).toBe('hello');
		expect(res.headers.get('x-origin')).toBe('yes');
	});
});

describe('anti-forgery', () => {
	test('drops visitor-supplied headers carrying our prefix', async () => {
		const s = setup();
		await s.run('https://shop.example.com/', {
			headers: {
				'x-ip2location-isp': 'Evil Corp',
				'X-IP2Location-Is-VPN': 'true',
				'X-IP2Location-Fraud-Score': '99',
				'X-IP2Location-Anything-Else': '1',
			},
		});

		const sent = s.chained[0]!;

		expect(sent.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');

		expect(sent.headers.get(P + 'Is-VPN')).toBe('false');

		expect(sent.headers.get(P + 'Fraud-Score')).toBe('0');
		expect(sent.headers.get(P + 'Anything-Else')).toBeNull();
	});

	test('strips forged headers even when the lookup fails', async () => {
		const s = setup({ api: () => new Response('down', { status: 503 }) });
		await s.run('https://shop.example.com/', { headers: { 'x-ip2location-isp': 'Evil Corp' } });

		const sent = s.chained[0]!;
		expect(sent.headers.get(P + 'ISP')).toBeNull();
		expect(sent.headers.get(P + 'Lookup')).toBe('error');
		expect(sent.headers.get(P + 'Error')).toContain('503');
	});
});

describe('failure handling', () => {
	test('still chains without enrichment headers when the lookup errors', async () => {
		const s = setup({ api: () => jsonResponse({ error: { error_code: 10002, error_message: 'Internal server error.' } }) });
		const res = await s.run('https://shop.example.com/');

		expect(s.chained.length).toBe(1);
		expect(s.chained[0]!.headers.get(P + 'ISP')).toBeNull();
		expect(s.chained[0]!.headers.get(P + 'Lookup')).toBe('error');
		expect(s.chained[0]!.headers.get(P + 'Error')).toBe('10002: Internal server error.');
		expect(res.status).toBe(200);
	});

	test('chains unenriched when Netlify supplies no address', async () => {
		const s = setup();
		await s.run('https://shop.example.com/', {}, { ip: undefined });

		expect(s.chained[0]!.headers.get(P + 'Lookup')).toBe('invalid');
		expect(s.lookups.length).toBe(0);
	});

	test('fails open when the cache itself throws', async () => {
		const broken: CacheLike = {
			get: async () => {
				throw new Error('cache unavailable');
			},
			set: async () => {},
		};
		const s = setup({ cache: broken });
		const res = await s.run('https://shop.example.com/');

		expect(res.status).toBe(200);
		expect(s.chained.length).toBe(1);
		expect(s.chained[0]!.headers.get(P + 'Lookup')).toBe('error');
	});
});

describe('caching', () => {
	test('a second request for the same network is served from cache', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');
		await s.run('https://shop.example.com/cart', {}, { ip: '175.144.151.200' });

		expect(s.chained[0]!.headers.get(P + 'Lookup')).toBe('miss');
		expect(s.chained[1]!.headers.get(P + 'Lookup')).toBe('hit');
		expect(s.lookups.length).toBe(1);
	});

	test('security fields survive the round trip through the cache', async () => {
		const s = setup({ api: () => jsonResponse(VPN_PAYLOAD) });
		await s.run('https://shop.example.com/', {}, { ip: '102.129.143.3' });
		await s.run('https://shop.example.com/', {}, { ip: '102.129.143.9' });

		expect(s.chained[1]!.headers.get(P + 'Lookup')).toBe('hit');
		expect(s.chained[1]!.headers.get(P + 'Proxy-Flags')).toBe('vpn');
		expect(s.chained[1]!.headers.get(P + 'Fraud-Score')).toBe('99');
	});
});

describe('debug endpoint', () => {
	test('reports the headers, the payload and what Netlify resolved', async () => {
		const s = setup({ env: { ALLOW_QUERY_IP: '1' } });
		const res = await s.run('https://shop.example.com/__ip2location?ip=175.144.151.253');
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.ip).toBe('175.144.151.253');
		expect(body.lookup).toBe('miss');
		expect(body.network).toBe('175.144.151.0');
		expect(body.headers['X-IP2Location-ISP']).toBe('Telekom Malaysia Berhad');
		expect(body.data.country_code).toBe('MY');

		expect(body.netlifyGeo.country.code).toBe('MY');
		expect(body.netlifyGeo.subdivision.name).toBe('Pulau Pinang');
	});

	test('ignores ?ip= unless overrides are allowed', async () => {
		const s = setup();
		const res = await s.run('https://shop.example.com/__ip2location?ip=8.8.8.8');
		expect((await res.json()).ip).toBe('175.144.151.253');
	});

	test('answers CORS preflight', async () => {
		const s = setup();
		const res = await s.run('https://shop.example.com/__ip2location', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
	});

	test('never forwards anything for the debug path', async () => {
		const s = setup({ env: { ALLOW_QUERY_IP: '1' } });
		await s.run('https://shop.example.com/__ip2location?ip=175.144.151.253');
		expect(s.chained.length).toBe(0);
	});
});
