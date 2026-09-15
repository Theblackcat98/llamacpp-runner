import { useEffect, useState } from "react";
import {
	type ParsedShellCommand,
	parseShellCommand,
	ShellImportError,
} from "../../core/import/shell";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
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
	const [commandText, setCommandText] = useState("");
	const [parseResult, setParseResult] = useState<ParsedShellCommand | null>(
		null,
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

	return (
		<box
			title="IMPORT SHELL COMMAND"
			style={{
				position: "absolute",
				left: 6,
				top: 4,
				width,
				height,
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
				label="cmd"
				placeholder="llama-server -m model.gguf -c 4096..."
				value={commandText}
				onChange={(st) => setCommandText(st.buffer)}
			/>
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
