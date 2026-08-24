import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	DEFAULT_THEME,
	THEMES,
	type Theme,
	type ThemeName,
	themeByName,
} from "./index";

export interface ThemeContextValue {
	theme: Theme;
	setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
	theme: DEFAULT_THEME,
	setTheme: () => {},
});

export function cycleTheme(current: string): ThemeName {
	const i = THEMES.findIndex((t) => t.name === current);
	const next = THEMES[(i + 1) % THEMES.length] ?? DEFAULT_THEME;
	return next.name as ThemeName;
}

export function ThemeProvider({
	initial,
	children,
}: {
	initial?: ThemeName;
	children: ReactNode;
}) {
	const [theme, setThemeState] = useState<Theme>(
		initial ? themeByName(initial) : DEFAULT_THEME,
	);
	const value = useMemo<ThemeContextValue>(
		() => ({
			theme,
			setTheme: (name) => setThemeState(themeByName(name)),
		}),
		[theme],
	);
	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextValue {
	return useContext(ThemeContext);
}
