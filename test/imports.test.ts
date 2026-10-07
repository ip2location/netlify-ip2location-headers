import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...tsFiles(path));
		else if (entry.name.endsWith('.ts')) out.push(path);
	}
	return out;
}

describe('relative imports', () => {
	test('carry a .ts extension so the Deno bundler can resolve them', () => {
		const offenders: string[] = [];

		for (const dir of ['lib', 'netlify']) {
			for (const file of tsFiles(join(ROOT, dir))) {
				const source = readFileSync(file, 'utf8');
				for (const match of source.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
					const specifier = match[1]!;
					if (!specifier.endsWith('.ts')) offenders.push(`${file}: ${specifier}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
