import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CORE_ROOT = resolve(import.meta.dir, "../src/core");

const FORBIDDEN_PACKAGES = ["@opentui", "react", "react-dom", "ink"];

function collectCoreFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...collectCoreFiles(full));
		} else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) {
			files.push(full);
		}
	}
	return files;
}

function extractSpecifiers(source: string): string[] {
	const specs: string[] = [];
	const patterns = [
		/\bfrom\s*["']([^"']+)["']/g,
		/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
		/\bimport\s+["']([^"']+)["']/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			specs.push(match[1] as string);
		}
	}
	return specs;
}

describe("core boundary rule (D5)", () => {
	it("src/core imports nothing from src/ui or any UI package", () => {
		const violations: string[] = [];

		for (const file of collectCoreFiles(CORE_ROOT)) {
			const specs = extractSpecifiers(readFileSync(file, "utf8"));
			for (const spec of specs) {
				if (
					FORBIDDEN_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`))
				) {
					violations.push(`${file}: imports UI package "${spec}"`);
					continue;
				}
				if (spec.startsWith(".")) {
					const target = resolve(dirname(file), spec);
					if (
						!target.startsWith(`${CORE_ROOT}/`) &&
						!target.startsWith(`${CORE_ROOT}\\`)
					) {
						violations.push(
							`${file}: "${spec}" crosses the core boundary (D5)`,
						);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
