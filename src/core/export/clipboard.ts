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
}

export type CopyResult =
	| { method: "osc52" | "xclip" | "xsel" | "wl_copy" | "pbcopy" }
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
	try {
		write(osc52Sequence(input.text));
		return { method: "osc52" };
	} catch {
		// not a tty or write refused — try local tools
	}
	for (const candidate of FALLBACK_ORDER) {
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
		notice:
			"clipboard unavailable: OSC 52 rejected and no fallback tool found (install xclip/xsel/wl-copy/pbcopy)",
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
