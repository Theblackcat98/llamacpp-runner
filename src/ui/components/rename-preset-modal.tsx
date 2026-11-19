import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import { overlayGeometry } from "./help-overlay";
import { TextInput } from "./text-input";

export interface RenamePresetModalProps {
	theme: Theme;
	open: boolean;
	/** The preset's current name — the input is prefilled with it. */
	currentName: string;
	onClose: () => void;
	onRename: (name: string) => void;
}

/**
 * Tier 3: rename prompt for the Presets tab (`n`), following the
 * SavePresetModal pattern — centered overlay geometry, Enter confirms,
 * Esc cancels. A blank submission is ignored by the store layer
 * (renamePreset no-ops), so an accidental Enter never erases a name.
 */
export function RenamePresetModal({
	theme,
	open,
	currentName,
	onClose,
	onRename,
}: RenamePresetModalProps) {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();
	const [name, setName] = useState("");

	// Prefill on open: the modal stays mounted, so sync when it opens
	// (or when the target preset changes while open).
	useEffect(() => {
		if (open) setName(currentName);
	}, [open, currentName]);

	useScopedKeyboard(open, (key) => {
		if (key.name === "escape") {
			onClose();
			return;
		}
		if (key.name === "return") {
			onRename(name);
		}
	});

	if (!open) return null;
	const geometry = overlayGeometry(termWidth, termHeight, 64, 8);
	return (
		<box
			title="Rename preset"
			style={{
				position: "absolute",
				left: geometry.left,
				top: geometry.top,
				width: geometry.width,
				height: geometry.height,
				border: true,
				borderColor: theme.accent,
				backgroundColor: theme.bg,
				flexDirection: "column",
				paddingLeft: 1,
				paddingRight: 1,
			}}
		>
			<text fg={theme.muted}>New name for the selected preset:</text>
			<TextInput
				theme={theme}
				captureKeys={open}
				focused
				label="name"
				placeholder={currentName}
				value={name}
				width={geometry.width - 4}
				onChange={(st) => setName(st.buffer)}
			/>
			<text fg={theme.muted}>{"[Enter] Rename   [Esc] Cancel"}</text>
		</box>
	);
}
