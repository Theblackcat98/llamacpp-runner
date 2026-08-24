export interface CheckboxState {
	checked: boolean;
}

export function createCheckboxState(initial = false): CheckboxState {
	return { checked: initial };
}

export function toggle(state: CheckboxState): CheckboxState {
	return { checked: !state.checked };
}
