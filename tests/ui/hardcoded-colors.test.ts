import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const UI_ROOT = resolve(import.meta.dir, "../../src/ui");

const ALLOWED = new Set([
	"src/ui/themes", // theme definitions are the single source of color
	"src/ui/logic/sgr.ts", // maps EXTERNAL llama-server ANSI colors to render names
]);

const HEX_COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
const NAMED_COLORS = new Set([
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"gray",
	"brightred",
	"brightgreen",
	"brightyellow",
	"brightblue",
	"brightmagenta",
	"brightcyan",
]);

function collectFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...collectFiles(path));
		else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
	}
	return out;
}

describe("hardcoded color gate (P2-FR-16)", () => {
	it("widget code contains zero color literals outside the theme module", () => {
		const violations: string[] = [];
		for (const file of collectFiles(UI_ROOT)) {
			const rel = file
				.replaceAll("\\", "/")
				.replace(UI_ROOT.replaceAll("\\", "/"), "src/ui/")
				.replace(/\/{2,}/g, "/");
			if ([...ALLOWED].some((a) => rel.startsWith(a))) continue;
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, idx) => {
				if (HEX_COLOR.test(line)) {
					violations.push(`${rel}:${idx + 1} hex literal`);
				} else {
					const prop = /(fg|bg|color|Color)\s*[=:]\s*["']([a-z]+)["']/g;
					for (const m of line.matchAll(prop)) {
						const color = m[2];
						if (color !== undefined && NAMED_COLORS.has(color)) {
							violations.push(`${rel}:${idx + 1} named color ${color}`);
						}
					}
				}
			});
		}
		expect(violations).toEqual([]);
	});
});
