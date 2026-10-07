import { HEADER_PREFIX, readConfig } from '../../lib/config.ts';
import type { Config } from '../../lib/config.ts';
import { DEFAULT_FIELDS } from '../../lib/fields.ts';
import { buildHeaders, headerSafe } from '../../lib/headers.ts';
import { lookupIp } from '../../lib/lookup.ts';
import { MemoryCache } from '../../lib/memory-cache.ts';
import type { CacheLike, ContextLike, Env, LookupResult } from '../../lib/types.ts';

const DEBUG_PATH = '/__ip2location';

const ENV_KEYS = ['IP2LOCATION_API_KEY', 'CACHE_TTL', 'CACHE_MAX', 'ALLOW_QUERY_IP', 'ALLOWED_ORIGINS'] as const;

interface NetlifyEnvLike {
	toObject?(): Record<string, string>;
	get?(name: string): string | undefined;
}

export interface HandlerDeps {
	fetch?: typeof fetch;
	cache?: CacheLike;
}

let moduleCache: MemoryCache | null = null;
let moduleCacheMax = -1;

function isolateCache(config: Config): CacheLike {
	if (moduleCache === null || moduleCacheMax !== config.cacheMax) {
		moduleCache = new MemoryCache(config.cacheMax);
		moduleCacheMax = config.cacheMax;
	}
	return moduleCache;
}

function readEnv(): Env {
	const api = (globalThis as { Netlify?: { env?: NetlifyEnvLike } }).Netlify?.env;
	if (!api) return {};
	if (typeof api.toObject === 'function') return api.toObject() as Env;
	if (typeof api.get !== 'function') return {};

	const out: Record<string, string> = {};
	for (const key of ENV_KEYS) {
		const value = api.get(key);
		if (value !== undefined) out[key] = value;
	}
	return out as Env;
}

export function createHandler(deps: HandlerDeps = {}) {
	return async function handler(request: Request, context: ContextLike): Promise<Response> {
		const url = new URL(request.url);
		const env = readEnv();
		const config = readConfig(env);

		const doFetch = deps.fetch ?? fetch;
		const cache = deps.cache ?? isolateCache(config);

		const resolve = (ip: string): Promise<LookupResult> =>
			lookupIp(ip, config, {
				fetch: doFetch,
				apiKey: env.IP2LOCATION_API_KEY,
				cache: config.ttl > 0 ? cache : undefined,
			});

		try {
			if (url.pathname === DEBUG_PATH) return await handleDebug(request, url, context, config, resolve);
			const result = await resolve(context.ip ?? '');
			return await forward(request, context, result);
		} catch (e) {
			console.error(`ip2location enrichment failed: ${(e as Error).message}`);
			return forward(request, context, { data: null, status: 'error', ip: '', network: '', error: 'runtime error' });
		}
	};
}

export default createHandler();

export const config = {
	path: '/*',
};

function stripPrefix(inbound: Headers): Headers {
	const prefix = HEADER_PREFIX.toLowerCase();
	const headers = new Headers();
	inbound.forEach((value, name) => {
		if (name.toLowerCase().startsWith(prefix)) return;
		headers.set(name, value);
	});
	return headers;
}

function applyEnrichment(headers: Headers, result: LookupResult): void {
	headers.set(`${HEADER_PREFIX}Lookup`, result.status);
	if (result.error !== undefined) headers.set(`${HEADER_PREFIX}Error`, headerSafe(result.error));
	if (!result.data) return;

	for (const [name, value] of Object.entries(buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS))) {
		headers.set(name, value);
	}
}

async function forward(request: Request, context: ContextLike, result: LookupResult): Promise<Response> {
	const headers = stripPrefix(request.headers);
	applyEnrichment(headers, result);
	return context.next(new Request(request, { headers }));
}

async function handleDebug(request: Request, url: URL, context: ContextLike, config: Config, resolve: (ip: string) => Promise<LookupResult>): Promise<Response> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'access-control-allow-origin': config.allowedOrigins,
		'access-control-allow-headers': 'content-type',
	};
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

	const override = config.allowQueryIp ? (url.searchParams.get('ip') ?? '').trim() : '';
	const result = await resolve(override !== '' ? override : (context.ip ?? ''));
	const emitted = result.data ? buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS) : {};

	return json(
		{
			ip: result.ip,
			lookup: result.status,
			network: result.network,
			error: result.error ?? null,
			netlifyGeo: context.geo ?? null,
			headers: emitted,
			data: result.data,
		},
		200,
		headers,
	);
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
	return new Response(JSON.stringify(body), { status, headers });
}
