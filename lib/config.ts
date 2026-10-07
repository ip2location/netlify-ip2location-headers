import type { Env } from './types.ts';

export const HEADER_PREFIX = 'X-IP2Location-';

export interface Config {
	ttl: number;
	cacheMax: number;
	allowQueryIp: boolean;
	allowedOrigins: string;
}

export function readConfig(env: Env): Config {
	return {
		ttl: toInt(env.CACHE_TTL, 3600),
		cacheMax: toInt(env.CACHE_MAX, 5000),
		allowQueryIp: truthy(env.ALLOW_QUERY_IP),
		allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').trim() || '*',
	};
}

export function toInt(value: string | undefined, fallback: number): number {
	const n = Number.parseInt((value ?? '').trim(), 10);
	return Number.isFinite(n) ? n : fallback;
}

export function truthy(value: string | undefined): boolean {
	const s = (value ?? '').trim().toLowerCase();
	return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
