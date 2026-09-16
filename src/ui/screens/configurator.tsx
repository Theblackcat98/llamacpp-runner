import { useEffect, useRef, useState } from "react";
import { REGISTRY } from "../../core/flags/registry";
import type { HardwareInfo } from "../../core/hardware/detect";
import { TuiBox } from "../components/box";
import { Checkbox } from "../components/checkbox";
import { ChipGroup } from "../components/chip-group";
import { CyclingSelect } from "../components/cycling-select";
import { Slider } from "../components/slider";
import { keyEventToInputKey, TextInput } from "../components/text-input";
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
	willItFitVerdict,
} from "../logic/configurator-state";
import type { Theme } from "../themes";

const KV_OPTIONS: KvQuant[] = ["f16", "q8_0", "q4_0"];

export interface ConfiguratorProps {
	theme: Theme;
	state: ConfiguratorState;
	hardware?: HardwareInfo | null;
	onChange?: (next: ConfiguratorState) => void;
	focused?: boolean;
	captureKeys?: boolean;
	onAutoFit?: () => void;
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
	hardware,
	onChange,
	focused = false,
	captureKeys = true,
	onAutoFit,
	onActiveFieldChange,
}: ConfiguratorProps) {
	const [field, setField] = useState(0);
	// #42: event-time mirror of `field`. A key batch (fast typing, paste,
	// tmux bursts) can move focus and deliver the next key before React
	// commits; handlers below consult this ref so ownership is correct
	// within the same tick, not one commit late.
	const fieldRef = useRef(0);

	// Notify exactly on mount + field change. Holding the callback in a
	// ref keeps parent callback-identity churn (inline arrows in App)
	// from re-firing this effect on every render (#37).
	const activeFieldCallback = useRef(onActiveFieldChange);
	activeFieldCallback.current = onActiveFieldChange;
	const moveField = (next: number) => {
		fieldRef.current = next;
		// Synchronous: the shell's yield guard must see the new owner before
		// any later key in the same batch is routed (#42).
		activeFieldCallback.current?.(next);
		setField(next);
	};
	useEffect(() => {
		fieldRef.current = field;
		activeFieldCallback.current?.(field);
	}, [field]);
	// #37: updates read the latest state through a ref (written back
	// optimistically) so several onChange calls processed in one batch —
	// fast typing, pasted keys — chain instead of last-write-wins on the
	// stale render-scope `state` closure.
	const stateRef = useRef(state);
	stateRef.current = state;
	const update = (mutate: (s: ConfiguratorState) => ConfiguratorState) => {
		const next = clampContext(mutate(stateRef.current));
		stateRef.current = next;
		onChange?.(next);
	};

	const boolRow = (id: string) => {
		const label = REGISTRY[id as keyof typeof REGISTRY]?.ui.label ?? id;
		return (
			<Checkbox
				key={id}
				theme={theme}
				captureKeys={captureKeys && field === FIELD[id]}
				focused={focused && field === FIELD[id]}
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
		if (key.name === "a" && !isConfiguratorTextField(fieldRef.current)) {
			onAutoFit?.();
			return;
		}
		if (key.name === "up") {
			moveField((fieldRef.current + FIELD_COUNT - 1) % FIELD_COUNT);
			return;
		}
		if (key.name === "down") {
			moveField((fieldRef.current + 1) % FIELD_COUNT);
			return;
		}
		// Same-tick boundary (#42): the move above hasn't committed, so the
		// target TextInput isn't subscribed yet — deliver printables through
		// state; the controlled-value sync shows them once it commits.
		if (fieldRef.current !== field) {
			const flag = TEXT_FIELD_FLAG[fieldRef.current];
			const mapped = keyEventToInputKey(key);
			if (flag && mapped?.kind === "printable") {
				if (flag !== "port" || /^[0-9]$/.test(mapped.ch)) {
					update((s) => {
						const current =
							typeof s.values[flag] === "string" ? s.values[flag] : "";
						return setFlag(s, flag, current + mapped.ch);
					});
				}
				return;
			}
		}
		// Enter (launch) and Ctrl+S (save) are owned by the shell (App) so a
		// single keypress causes exactly one action (Phase 13).
	});

	const ngl = numValue(state.values.n_gpu_layers, state.nglMax);
	const ctx = numValue(state.values.ctx_size, CTX_CHIPS[0] ?? 4096);
	const vram = vramRangeText(state);
	const preview = previewLine(state);
	const verdict = willItFitVerdict(state, hardware);
	const verdictColor =
		verdict.status === "fits"
			? theme.success
			: verdict.status === "no-fit"
				? theme.error
				: theme.warn;

	return (
		<box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
			<box style={{ flexDirection: "row", flexGrow: 1 }}>
				<TuiBox
					theme={theme}
					title="LAUNCH CONFIG"
					width="55%"
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
							focused={focused && field === 0}
							label="GPU Offload"
							min={0}
							max={Math.max(state.nglMax, 1)}
							value={ngl}
							width={24}
							onChange={(v) => update((s) => setFlag(s, "n_gpu_layers", v))}
						/>
						<box style={{ flexDirection: "column" }}>
							<text fg={focused && field === 1 ? theme.fgBright : theme.muted}>
								{focused && field === 1 ? "> Context Length" : "Context Length"}
							</text>
							<ChipGroup
								theme={theme}
								captureKeys={captureKeys && field === 1}
								focused={focused && field === 1}
								chips={CTX_CHIPS.map(String)}
								activeIndex={nearestChip(ctx)}
								onSelect={(i) =>
									update((s) => setFlag(s, "ctx_size", CTX_CHIPS[i]))
								}
							/>
						</box>
						<CyclingSelect
							theme={theme}
							captureKeys={captureKeys && field === 2}
							focused={focused && field === 2}
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
							focused={focused && field === 3}
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
						{boolRow("slots")}
						{boolRow("metrics")}
						<Slider
							theme={theme}
							captureKeys={captureKeys && field === 9}
							focused={focused && field === 9}
							label="Batch Size"
							min={1}
							max={8192}
							value={numValue(state.values.batch_size, 2048)}
							width={18}
							onChange={(v) => update((s) => setFlag(s, "batch_size", v))}
						/>
						<Slider
							theme={theme}
							captureKeys={captureKeys && field === 10}
							focused={focused && field === 10}
							label="Micro-batch"
							min={1}
							max={4096}
							value={numValue(state.values.ubatch_size, 512)}
							width={18}
							onChange={(v) => update((s) => setFlag(s, "ubatch_size", v))}
						/>
						<Slider
							theme={theme}
							captureKeys={captureKeys && field === 11}
							focused={focused && field === 11}
							label="Threads"
							min={1}
							max={256}
							value={numValue(state.values.threads, 8)}
							width={18}
							onChange={(v) => update((s) => setFlag(s, "threads", v))}
						/>
						<TextInput
							theme={theme}
							captureKeys={captureKeys && field === 12}
							focused={focused && field === 12}
							field={12}
							activeFieldRef={fieldRef}
							label="host"
							placeholder="127.0.0.1"
							value={strValue(state.values.host)}
							onChange={(st) =>
								update((s) => ({ ...setFlag(s, "host", st.buffer) }))
							}
						/>
						<TextInput
							theme={theme}
							captureKeys={captureKeys && field === 13}
							focused={focused && field === 13}
							field={13}
							activeFieldRef={fieldRef}
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
							captureKeys={captureKeys && field === 14}
							focused={focused && field === 14}
							field={14}
							activeFieldRef={fieldRef}
							label="alias"
							value={strValue(state.values.alias)}
							onChange={(st) => update((s) => setFlag(s, "alias", st.buffer))}
						/>
						<TextInput
							theme={theme}
							captureKeys={captureKeys && field === 15}
							focused={focused && field === 15}
							field={15}
							activeFieldRef={fieldRef}
							label="chat-template"
							value={strValue(state.values.chat_template)}
							onChange={(st) =>
								update((s) => setFlag(s, "chat_template", st.buffer))
							}
						/>
					</box>
				</TuiBox>
				<TuiBox theme={theme} title="RUNTIME" width="45%">
					<box style={{ flexDirection: "column", paddingLeft: 1 }}>
						{text(`Model: ${state.model?.path ?? "<none>"}`, theme.muted)}
						{text(`ngl max: ${state.nglMax} (block_count+1)`, theme.muted)}
						{text(vram ?? "VRAM: n/a (missing model metadata)", theme.warn)}
						{state.ctxWarning
							? text(`ctx warning: ${state.ctxWarning}`, theme.error)
							: text("", theme.muted)}
						{text("", theme.muted)}
						{text("[Enter] Launch", theme.fgBright)}
						{text("[Ctrl+S] Save Preset   [Esc] Reset", theme.muted)}
						{text("[Tab] focus console/screen  [y] Yank cmd", theme.muted)}
						{text("[a] Auto-fit ngl       [i] Import shell cmd", theme.muted)}
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
				height={5}
			>
				<text fg={state.restartRequired ? theme.warn : theme.success}>
					{preview.length > 0
						? ` $ ${preview}`
						: " <select a model in the Explorer>"}
				</text>
				{verdict.text ? (
					<text fg={verdictColor}>{` ${verdict.text}`}</text>
				) : null}
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

// Field focus order: core controls, telemetry, sizing, then text inputs.
const FIELD_COUNT = 16;
const FIELD: Record<string, number> = {
	flash_attn: 4,
	mlock: 5,
	no_mmap: 6,
	slots: 7,
	metrics: 8,
};

export const TEXT_FIELD_START_INDEX = 12;
export const TEXT_FIELD_END_INDEX = 15;

/** Field index → flag id for the text inputs (for same-tick forwarding, #42). */
const TEXT_FIELD_FLAG: Record<number, string> = {
	12: "host",
	13: "port",
	14: "alias",
	15: "chat_template",
};

/** Named contract: returns true if the focused field index is a text input (§2.3, Phase 13). */
export function isConfiguratorTextField(fieldIndex: number): boolean {
	return (
		fieldIndex >= TEXT_FIELD_START_INDEX && fieldIndex <= TEXT_FIELD_END_INDEX
	);
}

function text(content: string, color: string | undefined) {
	return <text fg={color}>{content}</text>;
}
