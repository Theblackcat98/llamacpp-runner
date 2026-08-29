import { useEffect, useState } from "react";
import { REGISTRY } from "../../core/flags/registry";
import { TuiBox } from "../components/box";
import { Checkbox } from "../components/checkbox";
import { ChipGroup } from "../components/chip-group";
import { CyclingSelect } from "../components/cycling-select";
import { Slider } from "../components/slider";
import { TextInput } from "../components/text-input";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import {
	type ConfiguratorState,
	CTX_CHIPS,
	clampContext,
	type KvQuant,
	previewLine,
	resetConfigurator,
	setFlag,
	vramRangeText,
} from "../logic/configurator-state";
import type { Theme } from "../themes";

const KV_OPTIONS: KvQuant[] = ["f16", "q8_0", "q4_0"];

export interface ConfiguratorProps {
	theme: Theme;
	state: ConfiguratorState;
	onChange?: (next: ConfiguratorState) => void;
	focused?: boolean;
	captureKeys?: boolean;
	/** Phase 13: reports the focused field index so the shell can yield global
	 * printable keys (digits, o/k/q/…) while a text field owns typing. */
	onActiveFieldChange?: (field: number) => void;
}

/**
 * Viewport 2 — Launch Configurator (§2.3, P4-FR-17): assembled exclusively
 * from Phase 2 widgets. Actions: Enter=Save&Launch · Ctrl+S=Save Preset ·
 * Esc=Reset. Live command preview + VRAM readout + restart-required marker.
 */
export function Configurator({
	theme,
	state,
	onChange,
	focused = false,
	captureKeys = true,
	onActiveFieldChange,
}: ConfiguratorProps) {
	const [field, setField] = useState(0);

	useEffect(() => {
		onActiveFieldChange?.(field);
	}, [field, onActiveFieldChange]);
	const update = (mutate: (s: ConfiguratorState) => ConfiguratorState) =>
		onChange?.(clampContext(mutate(state)));

	const boolRow = (id: string) => {
		const label = REGISTRY[id as keyof typeof REGISTRY]?.ui.label ?? id;
		return (
			<Checkbox
				key={id}
				theme={theme}
				captureKeys={captureKeys && field === FIELD[id]}
				focused={field === FIELD[id]}
				checked={state.values[id] === true}
				label={label}
				onToggle={() => update((s) => setFlag(s, id, !(s.values[id] === true)))}
			/>
		);
	};

	useScopedKeyboard(captureKeys, (key) => {
		if (key.name === "escape") {
			onChange?.(resetConfigurator(state));
			return;
		}
		if (key.name === "up") {
			setField((f) => (f + FIELD_COUNT - 1) % FIELD_COUNT);
			return;
		}
		if (key.name === "down") {
			setField((f) => (f + 1) % FIELD_COUNT);
			return;
		}
		// Enter (launch) and Ctrl+S (save) are owned by the shell (App) so a
		// single keypress causes exactly one action (Phase 13).
	});

	const ngl = numValue(state.values.n_gpu_layers, state.nglMax);
	const ctx = numValue(state.values.ctx_size, CTX_CHIPS[0] ?? 4096);
	const vram = vramRangeText(state);
	const preview = previewLine(state);

	return (
		<box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
			<box style={{ flexDirection: "row", flexGrow: 1 }}>
				<TuiBox
					theme={theme}
					title="LAUNCH CONFIG"
					width="55%"
					flexGrow={1}
					focused={focused}
				>
					<box
						style={{
							flexDirection: "column",
							paddingLeft: 1,
							gap: 0,
						}}
					>
						<Slider
							theme={theme}
							captureKeys={captureKeys && field === 0}
							focused={field === 0}
							label="GPU Offload"
							min={0}
							max={Math.max(state.nglMax, 1)}
							value={ngl}
							width={24}
							onChange={(v) => update((s) => setFlag(s, "n_gpu_layers", v))}
						/>
						<ChipGroup
							theme={theme}
							captureKeys={captureKeys && field === 1}
							focused={field === 1}
							chips={CTX_CHIPS.map(String)}
							activeIndex={nearestChip(ctx)}
							onSelect={(i) =>
								update((s) => setFlag(s, "ctx_size", CTX_CHIPS[i]))
							}
						/>
						<CyclingSelect
							theme={theme}
							captureKeys={captureKeys && field === 2}
							focused={field === 2}
							label="K Cache"
							options={KV_OPTIONS.slice()}
							index={kvIndex(state.values.cache_type_k)}
							onChange={(i) =>
								update((s) => setFlag(s, "cache_type_k", KV_OPTIONS[i]))
							}
						/>
						<CyclingSelect
							theme={theme}
							captureKeys={captureKeys && field === 3}
							focused={field === 3}
							label="V Cache"
							options={KV_OPTIONS.slice()}
							index={kvIndex(state.values.cache_type_v)}
							onChange={(i) =>
								update((s) => setFlag(s, "cache_type_v", KV_OPTIONS[i]))
							}
						/>
						{boolRow("flash_attn")}
						{boolRow("mlock")}
						{boolRow("no_mmap")}
						<TextInput
							theme={theme}
							captureKeys={captureKeys && field === 7}
							label="host"
							placeholder="127.0.0.1"
							value={strValue(state.values.host)}
							onChange={(st) =>
								update((s) => ({ ...setFlag(s, "host", st.buffer) }))
							}
						/>
						<TextInput
							theme={theme}
							captureKeys={captureKeys && field === 8}
							label="port"
							placeholder="8080"
							numeric
							value={strValue(state.values.port)}
							onChange={(st) => {
								const port = Number.parseInt(st.buffer || "8080", 10);
								update((s) =>
									setFlag(s, "port", Number.isFinite(port) ? port : 8080),
								);
							}}
						/>
						<TextInput
							theme={theme}
							captureKeys={captureKeys && field === 9}
							label="alias"
							value={strValue(state.values.alias)}
							onChange={(st) => update((s) => setFlag(s, "alias", st.buffer))}
						/>
					</box>
				</TuiBox>
				<TuiBox theme={theme} title="RUNTIME" flexGrow={1}>
					<box style={{ flexDirection: "column", paddingLeft: 1 }}>
						{text(`Model: ${state.model?.path ?? "<none>"}`, theme.muted)}
						{text(`ngl max: ${state.nglMax} (block_count+1)`, theme.muted)}
						{text(vram ?? "VRAM: n/a (missing model metadata)", theme.warn)}
						{state.ctxWarning
							? text(`ctx warning: ${state.ctxWarning}`, theme.error)
							: text("", theme.muted)}
						{text("", theme.muted)}
						{text("[Enter] Save & Launch", theme.fgBright)}
						{text("[Ctrl+S] Save Preset   [Esc] Reset", theme.muted)}
						{text("[Tab] cycle fields     [y] Yank cmd", theme.muted)}
					</box>
				</TuiBox>
			</box>
			<TuiBox
				theme={theme}
				title={
					state.restartRequired
						? "PREVIEW — RESTART REQUIRED"
						: "QUICK LAUNCH COMMAND PREVIEW"
				}
				height={4}
			>
				<text fg={state.restartRequired ? theme.warn : theme.success}>
					{preview.length > 0
						? ` $ ${preview}`
						: " <select a model in the Explorer>"}
				</text>
			</TuiBox>
		</box>
	);
}

function strValue(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function numValue(v: unknown, fallback: number): number {
	return typeof v === "number" ? v : fallback;
}

function kvIndex(v: unknown): number {
	return Math.max(KV_OPTIONS.indexOf(v as KvQuant), 0);
}

function nearestChip(ctx: number): number {
	let best = 0;
	for (let i = 0; i < CTX_CHIPS.length; i++) {
		const chip = CTX_CHIPS[i];
		if (chip !== undefined && chip <= ctx) best = i;
	}
	return best;
}

// Field focus order: 0 ngl slider, 1 ctx chips, 2 K cache, 3 V cache,
// 4 flash_attn, 5 mlock, 6 no_mmap, 7 host, 8 port, 9 alias.
const FIELD_COUNT = 10;
const FIELD: Record<string, number> = {
	flash_attn: 4,
	mlock: 5,
	no_mmap: 6,
};

function text(content: string, color: string | undefined) {
	return <text fg={color}>{content}</text>;
}
