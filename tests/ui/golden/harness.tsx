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

interface CapturedSpanLike {
	text: string;
	fg: unknown;
	bg: unknown;
	attributes: number;
}

interface CapturedLineLike {
	spans: CapturedSpanLike[];
}

interface CapturedFrameLike {
	lines: CapturedLineLike[];
}

/** Normalize an RGBA carrier (typed-array-backed) to #rrggbbaa. */
function rgbaToHex(rgba: unknown): string {
	const buffer =
		(rgba as { buffer?: { [index: number]: number } | number[] }).buffer ?? {};
	const ch = (index: number): string =>
		((buffer[index] ?? 0) & 0xff).toString(16).padStart(2, "0");
	return `#${ch(0)}${ch(1)}${ch(2)}${ch(3)}`;
}

/**
 * Deterministic span serialization: one line per row, each style run
 * rendered as JSON [text, fg, bg, attributes]. Adjacent spans with
 * identical style are MERGED first — the renderer's span splitting is an
 * implementation detail that varies between renders, so boundaries must
 * not leak into the snapshot.
 */
export function serializeSpans(frame: CapturedFrameLike): string {
	return frame.lines
		.map((line) => {
			const runs: string[] = [];
			let pending: {
				text: string;
				fg: string;
				bg: string;
				attributes: number;
			} | null = null;
			for (const span of line.spans) {
				const fg = rgbaToHex(span.fg);
				const bg = rgbaToHex(span.bg);
				if (
					pending &&
					pending.fg === fg &&
					pending.bg === bg &&
					pending.attributes === span.attributes
				) {
					pending.text += span.text;
					continue;
				}
				if (pending)
					runs.push(
						JSON.stringify([
							pending.text,
							pending.fg,
							pending.bg,
							pending.attributes,
						]),
					);
				pending = { text: span.text, fg, bg, attributes: span.attributes };
			}
			if (pending)
				runs.push(
					JSON.stringify([
						pending.text,
						pending.fg,
						pending.bg,
						pending.attributes,
					]),
				);
			return runs.join(",");
		})
		.join("\n");
}

/**
 * Render an element and compare its COLOR-AWARE span frame against
 * tests/ui/golden/<name>.spansnap (#21). Regenerate with UPDATE_GOLDEN=1.
 */
export async function expectGoldenSpans(
	name: string,
	element: ReactNode,
	options: GoldenOptions = {},
): Promise<void> {
	const { width = 40, height = 6, beforeCapture } = options;
	const setup = await testRender(element, { width, height });
	await act(async () => {
		await setup.flush();
	});
	if (beforeCapture) {
		await act(async () => {
			await beforeCapture(setup);
		});
	}
	let frame = "";
	await act(async () => {
		await setup.flush();
		frame = serializeSpans(setup.captureSpans());
		setup.renderer.destroy();
	});

	const file = join(GOLDEN_DIR, `${name}.spansnap`);
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
			`missing golden span frame ${name}.spansnap — run UPDATE_GOLDEN=1 bun test to create it`,
		);
	}
	expect(frame.replaceAll("\r\n", "\n")).toEqual(expected);
}
