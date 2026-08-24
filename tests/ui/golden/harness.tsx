import { expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";

const GOLDEN_DIR = new URL("./", import.meta.url).pathname;
const UPDATE = process.env.UPDATE_GOLDEN === "1";

export interface GoldenOptions {
	width?: number;
	height?: number;
}

/**
 * Render an element headlessly and compare the character frame against
 * tests/ui/golden/<name>.framesnap. Regenerate with UPDATE_GOLDEN=1 bun test.
 */
export async function expectGoldenFrame(
	name: string,
	element: ReactNode,
	options: GoldenOptions = {},
): Promise<void> {
	const { width = 40, height = 6 } = options;
	const setup = await testRender(element, { width, height });
	await setup.flush();
	const frame = setup.captureCharFrame();
	setup.renderer.destroy();

	const file = join(GOLDEN_DIR, `${name}.framesnap`);
	if (UPDATE) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, frame);
		return;
	}
	let expected: string;
	try {
		expected = readFileSync(file, "utf8");
	} catch {
		throw new Error(
			`missing golden frame ${name}.framesnap — run UPDATE_GOLDEN=1 bun test to create it`,
		);
	}
	expect(frame).toEqual(expected);
}
