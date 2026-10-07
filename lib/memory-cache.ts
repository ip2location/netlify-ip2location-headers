import type { CacheLike } from './types.ts';

export class MemoryCache implements CacheLike {
	private readonly entries = new Map<string, { value: unknown; expires: number }>();

	constructor(
		private readonly maxEntries = 5000,
		private readonly now: () => number = () => Date.now(),
	) {}

	get size(): number {
		return this.entries.size;
	}

	async get(key: string): Promise<unknown | undefined> {
		const entry = this.entries.get(key);
		if (entry === undefined) return undefined;
		if (entry.expires <= this.now()) {
			this.entries.delete(key);
			return undefined;
		}

		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
		if (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.entries.delete(oldest);
		}
		this.entries.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
	}
}
