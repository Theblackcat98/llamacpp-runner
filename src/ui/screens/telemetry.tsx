import { Badge } from "../components/badge";
import { TuiBox } from "../components/box";
import { Gauge } from "../components/gauge";
import { VirtualizedTable } from "../components/table";
import type { TelemetryViewModel } from "../logic/telemetry-state";
import type { Theme } from "../themes";

export interface TelemetryScreenProps {
	theme: Theme;
	vm: TelemetryViewModel;
	onEnableTelemetry?: () => void;
}

/**
 * Viewport 3 — Server Telemetry (§2.4, P5-FR-04): status header (badge,
 * model, uptime, endpoint), VRAM actual-vs-estimated + KV gauges, prompt/
 * decode sparklines, slots table. Dormant state when telemetry flags are
 * disabled (P5-FR-06); failure summary + last error lines on FAILED
 * (§6.4, P5-FR-15).
 */
export function Telemetry({
	theme,
	vm,
	onEnableTelemetry,
}: TelemetryScreenProps) {
	if (vm.dormant) {
		return (
			<box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
				<TuiBox theme={theme} title="SERVER TELEMETRY" flexGrow={1}>
					<box
						style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}
					>
						<text fg={theme.warn}> telemetry disabled for this launch</text>
						<text fg={theme.muted}>
							{" enable --slots / --metrics in the configurator to activate"}
						</text>
						{text(
							onEnableTelemetry ? " press [t] to toggle telemetry on" : "",
							theme.accent,
						)}
					</box>
				</TuiBox>
			</box>
		);
	}

	return (
		<box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
			<TuiBox theme={theme} title="STATUS" height={3}>
				<box style={{ flexDirection: "row", paddingLeft: 1 }}>
					<Badge theme={theme} status={vm.badge} label={vm.statusLabel} />
					<text fg={theme.fgBright}>{`  ${vm.modelLabel}`}</text>
					<text fg={theme.muted}>{`  up ${vm.uptime}`}</text>
					<text fg={theme.accent}>{`  ${vm.endpointLabel}`}</text>
				</box>
			</TuiBox>

			<TuiBox theme={theme} title="METERS" height={7}>
				<box style={{ flexDirection: "column", paddingLeft: 1 }}>
					<Gauge
						theme={theme}
						value={vm.vramFraction}
						width={24}
						label="VRAM"
					/>
					<text fg={theme.muted}>{`   ${vm.vramLabel}`}</text>
					<Gauge theme={theme} value={vm.kvFraction} width={24} label="KV" />
				</box>
			</TuiBox>

			<TuiBox theme={theme} title="THROUGHPUT" height={4}>
				<box style={{ flexDirection: "column", paddingLeft: 1 }}>
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
			</TuiBox>

			<TuiBox theme={theme} title="SLOTS (--slots)" flexGrow={1}>
				<VirtualizedTable
					theme={theme}
					columns={[
						{ key: "id", title: "ID", width: 6, align: "left" },
						{ key: "state", title: "STATE", width: 14, align: "left" },
						{ key: "ptok", title: "PROMPT TOKENS", width: 16, align: "right" },
						{ key: "gen", title: "GEN", width: 5, align: "left" },
					]}
					data={vm.slotRows.map((r) => ({
						id: r[0],
						state: r[1],
						ptok: r[2],
						gen: r[3],
					}))}
					viewport={6}
					captureKeys={false}
					focused={false}
				/>
			</TuiBox>

			{vm.failureSummary ? (
				<TuiBox theme={theme} title="FAILURE (§6.4)" height={8}>
					<box style={{ flexDirection: "column", paddingLeft: 1 }}>
						<text fg={theme.error}>{` ${vm.failureSummary}`}</text>
						{vm.failureSuggestion ? (
							<text fg={theme.warn}>{` fix: ${vm.failureSuggestion}`}</text>
						) : null}
						<text fg={theme.muted}> last lines:</text>
						{vm.errorTail.slice(-4).map((line) => (
							<text key={line} fg={theme.fg}>
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
