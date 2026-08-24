import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { createModelsService } from "../src/core/models/service";
import { saveConfig } from "../src/core/store/config";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const DIRS: string[] = [];

afterEach(() => {
	for (const dir of DIRS.splice(0)) {
		Bun.spawnSync(["rm", "-rf", dir]);
	}
});

function scratch(label: string): string {
	const dir = join(tmpdir(), `svc-${label}-${Date.now()}-${Math.random()}`);
	mkdirSync(dir, { recursive: true });
	DIRS.push(dir);
	return dir;
}

describe("models service over the bus (P3-FR-17/19)", () => {
	it("boots from persisted config and scans the configured dir", async () => {
		const models = scratch("models");
		const state = scratch("state");
		const config = scratch("config");
		writeFileSync(join(models, "m.gguf"), sampleLlamaQ4Km().buffer);
		saveConfig(config, { modelsDir: models });

		const bus = createBus<IntentMap, StateMap>();
		let dirEvent: string | null | undefined;
		let lastEntries: number | undefined;
		bus.onState("MODELS_DIR", (e) => {
			dirEvent = e.dir;
		});
		bus.onState("MODELS_STATE", (e) => {
			if (!e.scanning) lastEntries = e.entries.length;
		});

		const service = createModelsService(bus, {
			stateDir: state,
			configDir: config,
			pidFile: join(state, "server.pid"),
		});
		service.boot();

		await new Promise((r) => setTimeout(r, 300));
		expect(dirEvent).toBe(models);
		expect(lastEntries).toBe(1);
		service.dispose();
	});

	it("RESCAN intent triggers a fresh scan", async () => {
		const models = scratch("rescan-models");
		const state = scratch("rescan-state");
		const config = scratch("rescan-config");
		writeFileSync(join(models, "a.gguf"), sampleLlamaQ4Km().buffer);
		saveConfig(config, { modelsDir: models });

		const bus = createBus<IntentMap, StateMap>();
		let scans = 0;
		bus.onState("MODELS_STATE", (e) => {
			if (!e.scanning) scans++;
		});
		const service = createModelsService(bus, {
			stateDir: state,
			configDir: config,
			pidFile: "",
		});
		service.boot();
		await new Promise((r) => setTimeout(r, 300));
		const afterBoot = scans;

		writeFileSync(join(models, "b.gguf"), sampleLlamaQ4Km().buffer);
		bus.emitIntent("RESCAN", {});
		await new Promise((r) => setTimeout(r, 400));

		expect(scans).toBeGreaterThan(afterBoot);
		service.dispose();
	});
});
