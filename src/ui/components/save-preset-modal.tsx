import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import { overlayGeometry } from "./help-overlay";
import { TextInput } from "./text-input";

export interface SavePresetModalProps {
	theme: Theme;
	open: boolean;
	/** Suggested name (model basename) shown as the placeholder. */
	suggestion?: string;
	onClose: () => void;
	onSave: (name: string | undefined) => void;
}

/**
 * Tier 2: Ctrl+S used to save instantly under a raw UTC timestamp name.
 * This modal prompts for a name first (Enter saves, Esc cancels); an
 * empty name keeps the timestamp default in the host.
 * Placement uses the same centered overlay geometry as Help (audit #67:
 * unified modal placement — no fixed left/top offsets).
 */
export function SavePresetModal({
	theme,
	open,
	suggestion,
	onClose,
	onSave,
}: SavePresetModalProps) {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();
	const [name, setName] = useState("");

	useScopedKeyboard(open, (key) => {
		if (key.name === "escape") {
			setName("");
			onClose();
			return;
		}
		if (key.name === "return") {
			const trimmed = name.trim();
			setName("");
			onSave(trimmed.length > 0 ? trimmed : undefined);
		}
	});

	if (!open) return null;
	const geometry = overlayGeometry(termWidth, termHeight, 64, 8);
	return (
		<box
			title="Save preset"
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
			<text fg={theme.muted}>Preset name (blank = timestamp name):</text>
			<TextInput
				theme={theme}
				captureKeys={open}
				focused
				label="name"
				placeholder={suggestion ?? "my preset"}
				value={name}
				width={geometry.width - 4}
				onChange={(st) => setName(st.buffer)}
			/>
			<text fg={theme.muted}>{"[Enter] Save   [Esc] Cancel"}</text>
		</box>
	);
}
