import { expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { act } from "react";

const GOLDEN_DIR = import.meta.dir;
const UPDATE = process.env.UPDATE_GOLDEN === "1";

export interface GoldenOptions {
	width?: number;
	height?: number;
	beforeCapture?: (
		setup: Awaited<ReturnType<typeof testRender>>,
	) => void | Promise<void>;
}

/**
 * Wrap a testRender setup so its render + flush run inside React act — this
 * silences the "not wrapped in act" warnings (Phase 13).
 */
export async function renderWithAct(
	element: ReactNode,
	options: GoldenOptions = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
	const { width = 40, height = 6 } = options;
	const setup = await testRender(element, { width, height });
	await act(async () => {
		await setup.flush();
	});
	return setup;
}

/** Flush + destroy inside act to avoid post-test React updates. */
export async function teardownWithAct(
	setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
	await act(async () => {
		setup.renderer.destroy();
	});
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
	const { width = 40, height = 6, beforeCapture } = options;
	const setup = await testRender(element, { width, height });
	let frame = "";
	await act(async () => {
		await setup.flush();
	});
	if (beforeCapture) {
		await act(async () => {
			await beforeCapture(setup);
		});
	}
	await act(async () => {
		await setup.flush();
		frame = setup.captureCharFrame();
		setup.renderer.destroy();
	});

	const file = join(GOLDEN_DIR, `${name}.framesnap`);
	if (UPDATE) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, frame);
		return;
	}
	let expected: string;
	try {
		expected = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
	} catch {
		throw new Error(
			`missing golden frame ${name}.framesnap — run UPDATE_GOLDEN=1 bun test to create it`,
		);
	}
	expect(frame.replaceAll("\r\n", "\n")).toEqual(expected);
}
