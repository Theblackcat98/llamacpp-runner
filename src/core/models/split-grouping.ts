export interface SplitCandidate {
	name: string;
	path: string;
}

const SPLIT_RE = /^(?<base>.+)-(?<index>\d{5})-of-(?<total>\d{5})\.gguf$/;

export function splitBase(fileName: string): string | undefined {
	const m = SPLIT_RE.exec(fileName);
	return m?.groups?.base;
}

function splitIndex(fileName: string): number {
	const m = SPLIT_RE.exec(fileName);
	const index = m?.groups?.index;
	if (!index) throw new Error(`${fileName} is not a split part`);
	return Number.parseInt(index, 10);
}

/**
 * Groups `name-00001-of-0000M.gguf` siblings by base name (§7). Files that do
 * not match the split pattern are not included in the result.
 */
export function groupSplitFiles(
	files: SplitCandidate[],
): Map<string, SplitCandidate[]> {
	const groups = new Map<string, SplitCandidate[]>();
	for (const f of files) {
		const base = splitBase(f.name);
		if (!base) continue;
		const list = groups.get(base);
		if (list) list.push(f);
		else groups.set(base, [f]);
	}
	for (const list of groups.values()) {
		list.sort((a, b) => splitIndex(a.name) - splitIndex(b.name));
	}
	return groups;
}

/** Complete iff all M parts are present with indices 1..M (no dupes/gaps). */
export function isGroupComplete(parts: SplitCandidate[]): boolean {
	const first = parts[0];
	if (!first) return false;
	const total = totalParts(first.name);
	if (parts.length !== total) return false;
	const seen = new Set<number>();
	for (const p of parts) {
		const idx = splitIndex(p.name);
		if (idx < 1 || idx > total || seen.has(idx)) return false;
		seen.add(idx);
	}
	return true;
}

export function totalParts(fileName: string): number {
	const m = SPLIT_RE.exec(fileName);
	const total = m?.groups?.total;
	if (!total) throw new Error(`${fileName} is not a split part`);
	return Number.parseInt(total, 10);
}
