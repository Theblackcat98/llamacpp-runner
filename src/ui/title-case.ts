/**
 * Sentence-case for UI titles (#47): an ALL-CAPS title like
 * "QUICK LAUNCH COMMAND PREVIEW" becomes "Quick launch command preview".
 * Mixed-case titles ("Container Borders", "llama-deck") pass through
 * untouched — only shouting is quieted.
 */
export function toTitleCase(title: string): string {
	if (title !== title.toUpperCase()) return title;
	const lowered = title.toLowerCase();
	return lowered.replace(/\p{L}/u, (ch) => ch.toUpperCase());
}
