import { useEffect, useState } from "react";
import type { Theme } from "../themes";
import { gaugeBar, gaugeFillColor, sparkline } from "./gauge-state";

export interface GaugeProps {
	theme: Theme;
	value: number;
	width?: number;
	label?: string;
}

export function Gauge({ theme, value, width = 20, label }: GaugeProps) {
	return (
		<text>
			{label ? <span fg={theme.muted}>{`${label} [`}</span> : null}
			{!label ? <span fg={theme.muted}>[</span> : null}
			<span fg={gaugeFillColor(value, theme)}>{gaugeBar(value, width)}</span>
			<span fg={theme.muted}>]</span>
			<span fg={theme.fgBright}>{` ${Math.round(value * 100)}%`}</span>
		</text>
	);
}

export interface SparklineProps {
	theme: Theme;
	values: number[];
	width?: number;
	label?: string;
}

export function Sparkline({ theme, values, width, label }: SparklineProps) {
	const data = width !== undefined ? values.slice(-width) : values;
	return (
		<text>
			{label ? <span fg={theme.muted}>{`${label} `}</span> : null}
			<span fg={theme.accent}>{sparkline(data)}</span>
		</text>
	);
}

export function useTick(ms: number): number {
	const [tickCount, setTickCount] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTickCount((t) => t + 1), ms);
		return () => clearInterval(id);
	}, [ms]);
	return tickCount;
}
