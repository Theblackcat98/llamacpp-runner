/**
 * Shared UI shell constants (F16): a single source of truth so the host
 * (`main.tsx`) and the shell (`app.tsx`) can never drift apart.
 */

/** Console drawer viewport height (lines). */
export const DRAWER_HEIGHT = 6;

/**
 * Index of the Presets tab in the shell tab order (F17): shared so the host
 * (`main.tsx`, set-default persistence) and the shell (`app.tsx`, Enter
 * ownership) can never disagree about which tab is which.
 */
export const PRESETS_TAB = 3;

/** Index of the Launch Config tab (F3: preset load-and-go target). */
export const CONFIGURATOR_TAB = 1;
