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

	const applySgrParams = (params: string) => {
		for (const raw of params.split(";")) {
			const code = Number.parseInt(raw === "" ? "0" : raw, 10);
			if (Number.isNaN(code)) continue;
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
	};

	let i = 0;
	while (i < input.length) {
		if (input[i] === "\x1b" && input[i + 1] === "[") {
			let end = -1;
			for (let j = i + 2; j < input.length; j++) {
				const c = input.charCodeAt(j);
				if (c === 109) {
					applySgrParams(input.slice(i + 2, j));
					end = j + 1;
					break;
				}
				if (c >= 64 && c <= 126) {
					end = j + 1;
					break;
				}
			}
			if (end === -1) break;
			i = end;
			continue;
		}
		text += input[i];
		i++;
	}
	flush();
	if (out.length === 0) out.push({ text: "" });
	return out;
}
