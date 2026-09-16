import { Badge } from "../components/badge";
import { TuiBox } from "../components/box";
import { Gauge } from "../components/gauge";
import { VirtualizedTable } from "../components/table";
import type { IconSet } from "../glyphs";
import type { TelemetryViewModel } from "../logic/telemetry-state";
import type { Theme } from "../themes";

export interface TelemetryScreenProps {
	theme: Theme;
	vm: TelemetryViewModel;
	onEnableTelemetry?: () => void;
	focused?: boolean;
	/** Terminal width in columns; gauges scale to half the width. */
	width?: number;
	/** Nerd Font icons when "nerd", geometric ASCII glyphs otherwise. */
	iconSet?: IconSet;
}

/**
 * Viewport 3 — Server Telemetry (§2.4, P5-FR-04): 1-line status strip
 * (badge, model, uptime, endpoint), side-by-side VRAM/KV gauges,
 * prompt/decode sparklines, slots table. Dormant state when telemetry
 * flags are disabled (P5-FR-06); failure summary + last error lines on
 * FAILED (§6.4, P5-FR-15).
 *
 * #45: de-chromed — no titled boxes for status/meters/throughput; the
 * slots table and failure panel are the only boxed regions left, and
 * their titles are title-cased, not ALL-CAPS.
 */
export function Telemetry({
	theme,
	vm,
	onEnableTelemetry,
	focused = false,
	width = 100,
	iconSet = "ascii",
}: TelemetryScreenProps) {
	// Gauges sit side by side, so each gets half the terminal minus the
	// label/bracket/percent chrome (~14 cols) and padding.
	const gaugeWidth = Math.max(20, Math.floor(width / 2) - 14);

	if (vm.dormant) {
		return (
			<box
				style={{
					flexDirection: "column",
					width: "100%",
					height: "100%",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<text fg={theme.warn}>telemetry disabled for this launch</text>
				<text fg={theme.muted}>
					{"enable --slots / --metrics in the configurator to activate"}
				</text>
				{text(
					onEnableTelemetry ? "press [t] to toggle telemetry on" : "",
					theme.accent,
				)}
			</box>
		);
	}

	return (
		<box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
			{/* Status strip: 1 borderless line replacing the old STATUS box. */}
			<box style={{ flexDirection: "row", height: 1, paddingLeft: 1 }}>
				<Badge
					theme={theme}
					status={vm.badge}
					label={vm.statusLabel}
					iconSet={iconSet}
				/>
				<text fg={theme.fgBright}>{`  ${vm.modelLabel}`}</text>
				<text fg={theme.muted}>{`  up ${vm.uptime}`}</text>
				<text fg={theme.accent}>{`  ${vm.endpointLabel}`}</text>
			</box>

			{/* Meters: VRAM and KV gauges side by side, no METERS box. */}
			<box style={{ flexDirection: "row", marginTop: 1 }}>
				<box style={{ flexDirection: "column", width: "50%", paddingLeft: 1 }}>
					<Gauge
						theme={theme}
						value={vm.vramFraction}
						width={gaugeWidth}
						label="VRAM"
					/>
					<text fg={theme.muted}>{`   ${vm.vramLabel}`}</text>
				</box>
				<box style={{ flexDirection: "column", width: "50%", paddingLeft: 1 }}>
					<Gauge
						theme={theme}
						value={vm.kvFraction ?? 0}
						width={gaugeWidth}
						label="KV"
					/>
					<text fg={theme.muted}>
						{`   ${
							vm.kvFraction === null
								? "KV usage unavailable"
								: `${Math.round(vm.kvFraction * 100)}% of KV cache`
						}`}
					</text>
				</box>
			</box>

			{/* Throughput sparklines, borderless. */}
			<box style={{ flexDirection: "column", paddingLeft: 1, marginTop: 1 }}>
				<text>
					<span fg={theme.muted}>prompt </span>
					<span fg={theme.accent}>{vm.promptSpark}</span>
					<span fg={theme.fgBright}>
						{` ${vm.promptTpsLabel.replace("prompt t/s: ", "")}`}
					</span>
				</text>
				<text>
					<span fg={theme.muted}>decode </span>
					<span fg={theme.accent}>{vm.decodeSpark}</span>
					<span fg={theme.fgBright}>
						{` ${vm.decodeTpsLabel.replace("decode t/s: ", "")}`}
					</span>
				</text>
			</box>

			{/* Slots table: the screen's main panel, borderless with a muted
			    caption; focus shows through the table's own header/row
			    highlighting. */}
			<box
				style={{
					flexDirection: "column",
					flexGrow: 1,
					marginTop: 1,
					paddingLeft: 1,
				}}
			>
				<text fg={theme.muted}>Slots</text>
				<VirtualizedTable
					theme={theme}
					columns={[
						{ key: "id", title: "ID", width: 6, align: "left" },
						{ key: "state", title: "STATE", width: 14, align: "left" },
						{ key: "ptok", title: "PROMPT TOKENS", width: 16, align: "right" },
						{ key: "dtok", title: "DECODED", width: 10, align: "right" },
						{ key: "gen", title: "GEN", width: 5, align: "left" },
					]}
					data={vm.slotRows.map((r) => ({
						id: r[0],
						state: r[1],
						ptok: r[2],
						dtok: r[3],
						gen: r[4],
					}))}
					viewport={6}
					captureKeys={false}
					focused={focused}
				/>
			</box>

			{vm.failureSummary ? (
				<TuiBox theme={theme} title="Failure (§6.4)" height={8}>
					<box style={{ flexDirection: "column", paddingLeft: 1 }}>
						<text fg={theme.error}>{` ${vm.failureSummary}`}</text>
						{vm.failureSuggestion ? (
							<text fg={theme.warn}>{` fix: ${vm.failureSuggestion}`}</text>
						) : null}
						<text fg={theme.muted}> last lines:</text>
						{vm.errorTail.slice(-4).map((line, idx) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: error tail lines may be identical
							<text key={idx} fg={theme.fg}>
								{` | ${line}`}
							</text>
						))}
					</box>
				</TuiBox>
			) : null}
		</box>
	);
}

function text(content: string, color: string | undefined) {
	return <text fg={color}>{content}</text>;
}
