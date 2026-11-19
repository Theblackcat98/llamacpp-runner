import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import {
	type ParsedShellCommand,
	parseShellCommand,
	ShellImportError,
} from "../../core/import/shell";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import { overlayGeometry } from "./help-overlay";
import { TextInput } from "./text-input";

export interface ImportModalProps {
	theme: Theme;
	open: boolean;
	onClose: () => void;
	onImport: (parsed: ParsedShellCommand, rawInput: string) => void;
	width?: number;
	height?: number;
}

/**
 * Shell Command Import Modal dialog (§3.3, Issue #6).
 *
 * Allows pasting/typing a raw shell invocation (e.g. from HF model card or forum):
 * - Live parsing feedback using strict tokenizer (src/core/import/shell.ts)
 * - Highlights modelPath, recognized flags count, or errors
 * - Enter commits the import, Esc cancels
 */
export function ImportModal({
	theme,
	open,
	onClose,
	onImport,
	width = 72,
	height = 12,
}: ImportModalProps) {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();
	const [commandText, setCommandText] = useState("");
	const [parseResult, setParseResult] = useState<ParsedShellCommand | null>(
		null,
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// #67: reopening the modal must not resurrect the last command.
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) {
			setCommandText("");
			setParseResult(null);
			setErrorMessage(null);
		}
		wasOpen.current = open;
	}, [open]);

	useEffect(() => {
		if (!commandText.trim()) {
			setParseResult(null);
			setErrorMessage(null);
			return;
		}

		try {
			const res = parseShellCommand(commandText);
			setParseResult(res);
			setErrorMessage(null);
		} catch (e) {
			setParseResult(null);
			if (e instanceof ShellImportError || e instanceof Error) {
				setErrorMessage(e.message);
			} else {
				setErrorMessage(String(e));
			}
		}
	}, [commandText]);

	useScopedKeyboard(open, (key) => {
		if (key.name === "escape") {
			onClose();
			return;
		}
		if (key.name === "return") {
			if (parseResult) {
				onImport(parseResult, commandText);
				onClose();
			}
		}
	});

	if (!open) return null;

	const flagCount = parseResult ? Object.keys(parseResult.values).length : 0;
	const unknownCount = parseResult ? parseResult.unknownFlags.length : 0;
	// #67: unified modal placement — centered like Help/Save, sized to the
	// terminal instead of a fixed 72-col box at a fixed offset.
	const modalWidth = Math.min(width, Math.max(40, termWidth - 4));
	const geometry = overlayGeometry(termWidth, termHeight, modalWidth, height);

	return (
		<box
			title="Import shell command"
			style={{
				position: "absolute",
				left: geometry.left,
				top: geometry.top,
				width: geometry.width,
				height: geometry.height,
				border: true,
				borderColor: errorMessage ? theme.error : theme.accent,
				backgroundColor: theme.bg,
				flexDirection: "column",
				paddingLeft: 1,
				paddingRight: 1,
			}}
		>
			<text fg={theme.muted}>
				Paste a llama-server command (HF model card or export):
			</text>
			<TextInput
				theme={theme}
				captureKeys={open}
				focused
				label="cmd"
				placeholder="llama-server -m model.gguf -c 4096..."
				value={commandText}
				width={geometry.width - 4}
				onChange={(st) => setCommandText(st.buffer)}
			/>
			<text fg={theme.muted}>
				{"Tip: use 'single quotes' for paths with spaces."}
			</text>
			<text>{""}</text>
			{errorMessage ? (
				<text fg={theme.error}>{`Error: ${errorMessage}`}</text>
			) : parseResult ? (
				<box style={{ flexDirection: "column" }}>
					<text fg={theme.fgBright}>
						{`Model: ${parseResult.modelPath || "<none>"}`}
					</text>
					<text fg={theme.muted}>
						{`Flags recognized: ${flagCount} ${unknownCount > 0 ? `(${unknownCount} unknown ignored)` : ""}`}
					</text>
				</box>
			) : (
				<text fg={theme.muted}>Awaiting input...</text>
			)}
			<text>{""}</text>
			<text fg={theme.muted}>
				{parseResult
					? "[Enter] Import to Configurator   [Esc] Cancel"
					: "[Esc] Cancel"}
			</text>
		</box>
	);
}
