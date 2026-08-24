export class LineAssembler {
	private chars: string[] = [];
	private pos = 0;

	push(chunk: string): string[] {
		const out: string[] = [];
		for (const ch of chunk) {
			if (ch === "\r") {
				this.pos = 0;
			} else if (ch === "\n") {
				out.push(this.chars.join(""));
				this.reset();
			} else {
				this.chars[this.pos] = ch;
				this.pos++;
			}
		}
		return out;
	}

	flush(): string[] {
		if (this.chars.length === 0) return [];
		const line = this.chars.join("");
		this.reset();
		return [line];
	}

	private reset(): void {
		this.chars = [];
		this.pos = 0;
	}
}
