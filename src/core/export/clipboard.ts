/**
 * Clipboard export (D6, P4-FR-16a): OSC 52 primary (works over SSH),
 * fallback chain xclip -> xsel -> wl-copy -> pbcopy. Total failure yields a
 * graceful notice — never throws.
 */

export interface ClipboardRunners {
	xclip?: (text: string) => boolean;
	xsel?: (text: string) => boolean;
	wl_copy?: (text: string) => boolean;
	pbcopy?: (text: string) => boolean;
}

export interface CopyInput {
	text: string;
	/** Terminal writer for the OSC 52 sequence (defaults to stdout). */
	writeFn?: (s: string) => void;
	/** Injectable fallback runners; defaults spawn the real tools. */
	runners?: ClipboardRunners;
	/** Injectable tool lookup (defaults Bun.which). */
	whichFn?: (command: string) => string | null;
	/**
	 * #62: value of LLAMA_DECK_CLIPBOARD. A tool name (xclip/xsel/wl_copy/
	 * pbcopy) allowlists exactly that tool and skips OSC 52; any other
	 * non-empty value opts out of OSC 52 and walks the fallback chain.
	 * Unset / "osc52" keeps the OSC-first default.
	 */
	clipboardEnv?: string;
}

export type CopyResult =
	/**
	 * #62: honest name — OSC 52 write proves the sequence was SENT, not
	 * that the terminal accepted it. Local tool runs are verified.
	 */
	| { method: "osc52-unconfirmed" | "xclip" | "xsel" | "wl_copy" | "pbcopy" }
	| { method: "failed"; notice: string };

const FALLBACK_ORDER: { name: keyof ClipboardRunners; argv: string[] }[] = [
	{ name: "xclip", argv: ["xclip", "-selection", "clipboard"] },
	{ name: "xsel", argv: ["xsel", "--clipboard", "--input"] },
	{ name: "wl_copy", argv: ["wl-copy"] },
	{ name: "pbcopy", argv: ["pbcopy"] },
];

export function osc52Sequence(text: string): string {
	return `\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`;
}

export function copyToClipboard(input: CopyInput): CopyResult {
	const write = input.writeFn ?? ((s: string) => process.stdout.write(s));
	const which = input.whichFn ?? ((c) => Bun.which(c));
	// #62: env opt-out / tool allowlist so the fallback chain is reachable
	// on terminals that silently ignore OSC 52 (alacritty, tmux, …).
	const envMode = input.clipboardEnv ?? process.env.LLAMA_DECK_CLIPBOARD ?? "";
	const oscDisabled = envMode !== "" && envMode !== "osc52";
	const allowlisted = FALLBACK_ORDER.find((c) => c.name === envMode);
	if (!oscDisabled) {
		try {
			write(osc52Sequence(input.text));
			return { method: "osc52-unconfirmed" };
		} catch {
			// not a tty or write refused — try local tools
		}
	}
	for (const candidate of FALLBACK_ORDER) {
		if (allowlisted && candidate.name !== allowlisted.name) continue;
		const injected = input.runners?.[candidate.name];
		if (injected) {
			if (injected(input.text)) return { method: candidate.name };
			continue;
		}
		const tool = candidate.argv[0];
		if (tool && which(tool)) {
			if (spawnCopy(candidate.argv, input.text)) {
				return { method: candidate.name };
			}
		}
	}
	return {
		method: "failed",
		notice: allowlisted
			? `clipboard unavailable: LLAMA_DECK_CLIPBOARD=${envMode} but the tool is missing or failed`
			: "clipboard unavailable: OSC 52 rejected and no fallback tool found (install xclip/xsel/wl-copy/pbcopy)",
	};
}

function spawnCopy(argv: string[], text: string): boolean {
	try {
		const proc = Bun.spawnSync(argv, {
			stdin: new Blob([text]),
			stdout: "ignore",
			stderr: "ignore",
		});
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}
