import { TuiBox } from "../components/box";
import type { Theme } from "../themes";

const BANNER = [
	" ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗██╗  ██╗██╗   ██╗██╗",
	"██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║██║  ██║██║   ██║██║",
	"██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║██║  ██║██║   ██║██║",
	"██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║██║  ██║██║   ██║██║",
	"╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ██║╚█████╔╝╚██████╔╝██║",
	" ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚════╝  ╚═════╝ ╚═╝",
];

const TREE_NODES: Array<{ text: string; accent?: boolean }> = [
	{ text: "▼ src/" },
	{ text: "  ├─ index.tsx", accent: true },
	{ text: "  ├─ layout.ts" },
	{ text: "  └─ native.zig" },
	{ text: "► package.json" },
];

interface DemoRow {
	id: string;
	process: string;
	cpu: string;
	cpuColor: (t: Theme) => string;
	mem: string;
	status: string;
	statusColor: (t: Theme) => string;
}

const DEMO_ROWS: DemoRow[] = [
	{
		id: "#1024",
		process: "opentui-core",
		cpu: "2.4%",
		cpuColor: (t) => t.success,
		mem: "14.2 MB",
		status: "RUNNING",
		statusColor: (t) => t.success,
	},
	{
		id: "#1025",
		process: "zig-frame-diff",
		cpu: "18.7%",
		cpuColor: (t) => t.accent,
		mem: "42.8 MB",
		status: "RUNNING",
		statusColor: (t) => t.success,
	},
	{
		id: "#1028",
		process: "tree-sitter-c",
		cpu: "0.0%",
		cpuColor: (t) => t.muted,
		mem: "8.1 MB",
		status: "SLEEPING",
		statusColor: (t) => t.warn,
	},
];

function formatRow(row: DemoRow): string {
	return `${row.id.padEnd(7)}${row.process.padEnd(15)}${row.cpu.padEnd(8)}${row.mem.padEnd(9)}${row.status}`;
}

function DemoTableRow({ theme, row }: { theme: Theme; row: DemoRow }) {
	const cells = [
		{ text: `${row.id.padEnd(7)}${row.process.padEnd(15)}`, fg: theme.fg },
		{ text: row.cpu.padEnd(8), fg: row.cpuColor(theme) },
		{ text: row.mem.padEnd(9), fg: theme.fg },
		{ text: row.status, fg: row.statusColor(theme) },
	];
	return (
		<text>
			{cells.map((cell) => (
				<span key={cell.text} fg={cell.fg}>
					{cell.text}
				</span>
			))}
		</text>
	);
}

export function Catalog({ theme }: { theme: Theme }) {
	return (
		<box
			style={{
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: theme.bg,
				paddingLeft: 1,
				paddingRight: 1,
			}}
		>
			<TuiBox theme={theme} variant="rounded">
				<box style={{ flexDirection: "column" }}>
					{BANNER.map((line) => (
						<text key={line} fg={theme.accent}>
							{line}
						</text>
					))}
					<text>
						<span fg={theme.muted}>
							Declarative TUI primitives with native frame diffing.{" "}
						</span>
						<span fg={theme.accent}>[Press Tab to navigate focus]</span>
					</text>
				</box>
			</TuiBox>

			<box style={{ flexDirection: "row" }}>
				<TuiBox
					theme={theme}
					title="Container Borders"
					width="50%"
					flexGrow={1}
				>
					<box style={{ flexDirection: "column" }}>
						<box style={{ flexDirection: "row" }}>
							<TuiBox theme={theme} variant="single" width="50%" flexGrow={1}>
								<text>
									<span fg={theme.fgBright}>Single </span>
									<span fg={theme.muted}>{'"single"'}</span>
								</text>
							</TuiBox>
							<TuiBox theme={theme} variant="double" width="50%" flexGrow={1}>
								<text>
									<span fg={theme.fgBright}>Double </span>
									<span fg={theme.muted}>{'"double"'}</span>
								</text>
							</TuiBox>
						</box>
						<box style={{ flexDirection: "row" }}>
							<TuiBox theme={theme} variant="rounded" width="50%" flexGrow={1}>
								<text>
									<span fg={theme.fgBright}>Round </span>
									<span fg={theme.muted}>{'"round"'}</span>
								</text>
							</TuiBox>
							<TuiBox theme={theme} variant="heavy" width="50%" flexGrow={1}>
								<text>
									<span fg={theme.fgBright}>Heavy </span>
									<span fg={theme.muted}>{'"heavy"'}</span>
								</text>
							</TuiBox>
						</box>
					</box>
				</TuiBox>

				<TuiBox
					theme={theme}
					title="Typography & Styles"
					width="50%"
					flexGrow={1}
				>
					<box style={{ flexDirection: "column" }}>
						<text>
							<span fg={theme.fgBright}>Bold: </span>
							<b fg={theme.fg}>The quick brown fox</b>
						</text>
						<text>
							<span fg={theme.fgBright}>Dim / Muted: </span>
							<span fg={theme.muted}>jumps over the lazy dog</span>
						</text>
						<text>
							<span fg={theme.fgBright}>Italic+Underline: </span>
							<i fg={theme.fg}>
								<u> ANSI decorators</u>
							</i>
						</text>
						<text>
							<span fg={theme.fgBright}>Inverse: </span>
							<span fg={theme.bg} bg={theme.fg}>
								{" SELECTED ROW "}
							</span>
						</text>
						<text>
							<span fg={theme.bg} bg={theme.accent}>
								{" BLUE "}
							</span>
							<span fg={theme.bg} bg={theme.success}>
								{" GREEN "}
							</span>
							<span fg={theme.bg} bg={theme.warn}>
								{" YELLOW "}
							</span>
							<span fg={theme.bg} bg={theme.error}>
								{" RED "}
							</span>
							<span fg={theme.bg} bg={theme.purple}>
								{" PURPLE "}
							</span>
						</text>
					</box>
				</TuiBox>
			</box>

			<box style={{ flexDirection: "row", flexGrow: 1 }}>
				<TuiBox theme={theme} title="Data Table & Grid" width="52%">
					<box style={{ flexDirection: "column" }}>
						<text fg={theme.fgBright}>
							{"ID     PROCESS        CPU %  MEM      STATUS"}
						</text>
						{DEMO_ROWS.map((row) => (
							<DemoTableRow key={row.id} theme={theme} row={row} />
						))}
					</box>
				</TuiBox>

				<TuiBox
					theme={theme}
					title="File Tree & Syntax Highlight"
					width="48%"
					flexGrow={1}
				>
					<box style={{ flexDirection: "row" }}>
						<box style={{ flexDirection: "column", width: 16 }}>
							{TREE_NODES.map((node) => (
								<text
									key={node.text}
									fg={node.accent ? theme.accent : theme.fg}
								>
									{node.text}
								</text>
							))}
						</box>
						<box
							style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}
						>
							<text>
								<b fg={theme.purple}>import</b>
								<span fg={theme.fg}>{" { createRoot }"}</span>
							</text>
							<text>
								<span fg={theme.fg}> </span>
								<b fg={theme.purple}>from</b>
								<span fg={theme.success}>{' "@opentui/react";'}</span>
							</text>
							<text>
								<b fg={theme.purple}>function</b>
								<span fg={theme.accent}> App</span>
								<span fg={theme.fg}>() {"{"}</span>
							</text>
							<text fg={theme.fg}>{"  return ("}</text>
							<text>
								<span fg={theme.fg}>{"  <"}</span>
								<span fg={theme.accent}>box</span>
								<span fg={theme.fg}>{" borderStyle="}</span>
								<span fg={theme.success}>{'"round">'}</span>
							</text>
							<text>
								<span fg={theme.fg}>{"    <"}</span>
								<span fg={theme.accent}>text</span>
								<span fg={theme.fg}>{">Hello TUI<"}</span>
								<span fg={theme.accent}>/text</span>
								<span fg={theme.fg}>{">"}</span>
							</text>
							<text fg={theme.fg}>{"  </box>"}</text>
							<text fg={theme.fg}>{"  );"}</text>
							<text fg={theme.fg}>{"}"}</text>
						</box>
					</box>
				</TuiBox>
			</box>
		</box>
	);
}

export { formatRow };
