export const TAB_COUNT = 4;

export interface KeyRef {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
}

export function nextTab(current: number): number {
	return (current + 1) % TAB_COUNT;
}

export function cycleFocus(
	count: number,
	current: number,
	forward: boolean,
): number {
	if (count <= 0) return 0;
	return (current + (forward ? 1 : count - 1)) % count;
}

export function isQuitKey(key: KeyRef): boolean {
	if (key.ctrl && key.name === "c") return true;
	return key.name?.toLowerCase() === "q";
}
