export interface Env {
	IP2LOCATION_API_KEY?: string;
	CACHE_TTL?: string;
	CACHE_MAX?: string;
	ALLOW_QUERY_IP?: string;
	ALLOWED_ORIGINS?: string;
}

export interface GeoLike {
	city?: string;
	country?: { code?: string; name?: string };
	subdivision?: { code?: string; name?: string };
	latitude?: number;
	longitude?: number;
	timezone?: string;
	postalCode?: string;
}

export interface ContextLike {
	ip?: string;
	geo?: GeoLike;

	next(request?: Request, options?: { sendConditionalRequest?: boolean }): Promise<Response>;
	waitUntil(promise: Promise<unknown>): void;
}

export interface CacheLike {
	get(key: string): Promise<unknown | undefined>;
	set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export type IpData = Record<string, unknown>;

export interface LookupResult {
	data: IpData | null;
	status: 'hit' | 'miss' | 'error' | 'invalid' | 'off';
	ip: string;
	network: string;
	error?: string;
}
