import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_PREFIX, readConfig } from '../lib/config.ts';
import { DEFAULT_FIELDS } from '../lib/fields.ts';
import { buildHeaders } from '../lib/headers.ts';
import { lookupIp } from '../lib/lookup.ts';
import { MemoryCache } from '../lib/memory-cache.ts';
import type { Env } from '../lib/types.ts';

const DEFAULTS = ['175.144.151.253', '8.8.8.8', '102.129.143.3', '2001:4860:4860::8888'];

function dotEnv(): Record<string, string> {
	const path = join(import.meta.dir, '..', '.env');
	if (!existsSync(path)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
	}
	return out;
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const list = targets.length > 0 ? [...targets, targets[0]!] : [...DEFAULTS, DEFAULTS[0]!];

const env = dotEnv() as Env;
const config = readConfig(env);

if (!env.IP2LOCATION_API_KEY) {
	console.log('No IP2LOCATION_API_KEY in .env; falling back to the keyless lane.\n');
}

const cache = new MemoryCache();
let calls = 0;
const countingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	calls++;
	return fetch(input, init);
}) as unknown as typeof fetch;

console.log(`fields: ${DEFAULT_FIELDS.length} (${DEFAULT_FIELDS.join(', ')})`);
console.log('');

for (const ip of list) {
	const result = await lookupIp(ip, config, { fetch: countingFetch, apiKey: env.IP2LOCATION_API_KEY, cache });

	console.log(`${ip}  ->  ${result.status}  [${result.network || '-'}]`);
	if (result.error) console.log(`    error: ${result.error}`);
	if (result.data) {
		for (const [name, value] of Object.entries(buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS))) {
			console.log(`    ${name}: ${value}`);
		}
	}
	console.log('');
}

console.log(`API calls: ${calls}, cache entries: ${cache.size}`);
console.log('The last address repeats the first, so it should report "hit".');
