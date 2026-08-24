export interface TextSegment {
	text: string;
	fg?: string;
	bold?: boolean;
}

const BASIC_FG: Record<number, string> = {
	30: "black",
	31: "red",
	32: "green",
	33: "yellow",
	34: "blue",
	35: "magenta",
	36: "cyan",
	37: "white",
	90: "gray",
	91: "brightred",
	92: "brightgreen",
	93: "brightyellow",
	94: "brightblue",
	95: "brightmagenta",
	96: "brightcyan",
	97: "white",
};

export function parseSgr(input: string): TextSegment[] {
	const out: TextSegment[] = [];
	let text = "";
	let fg: string | undefined;
	let bold = false;

	const flush = () => {
		if (text.length === 0) return;
		const seg: TextSegment = { text };
		if (fg !== undefined) seg.fg = fg;
		if (bold) seg.bold = true;
		out.push(seg);
		text = "";
	};

	let i = 0;
	while (i < input.length) {
		if (input[i] === "\x1b" && input[i + 1] === "[") {
			const end = input.indexOf("m", i + 2);
			if (end === -1) break;
			for (const raw of input.slice(i + 2, end).split(";")) {
				const code = Number.parseInt(raw === "" ? "0" : raw, 10);
				if (code === 0) {
					flush();
					fg = undefined;
					bold = false;
				} else if (code === 1) {
					flush();
					bold = true;
				} else if (code === 22) {
					flush();
					bold = false;
				} else if (code === 39) {
					flush();
					fg = undefined;
				} else {
					const named = BASIC_FG[code];
					if (named !== undefined) {
						flush();
						fg = named;
					}
				}
			}
			i = end + 1;
			continue;
		}
		text += input[i];
		i++;
	}
	flush();
	if (out.length === 0) out.push({ text: "" });
	return out;
}
