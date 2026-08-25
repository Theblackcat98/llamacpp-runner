#!/usr/bin/env bun
// Mock llama-server HTTP surface: /health (503 window -> 200), /slots, /metrics.
// Used standalone by telemetry tests and delegated to from fake-server.sh --http.
interface Args {
	port: number;
	health503Ms: number;
	metricsMalformed: boolean;
}

function parseArgs(argv: string[]): Args {
	const out: Args = { port: 8080, health503Ms: 0, metricsMalformed: false };
	for (let i = 2; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				out.port = Number(argv[++i]);
				break;
			case "--health-503-ms":
				out.health503Ms = Number(argv[++i]);
				break;
			case "--metrics-malformed":
				out.metricsMalformed = true;
				break;
		}
	}
	return out;
}

const { port, health503Ms, metricsMalformed } = parseArgs(process.argv);
const startedAt = Date.now();

export const CANNED_SLOTS = [
	{ id: 0, state: "ACTIVE", prompt_tokens: 128, generating: true },
	{ id: 1, state: "IDLE", prompt_tokens: 0, generating: false },
];

export const CANNED_METRICS = `# HELP llamacpp:prompt_tokens_seconds_total prompt t/s
# TYPE llamacpp:prompt_tokens_seconds_total counter
llamacpp:prompt_tokens_seconds_total 812.5
# TYPE llamacpp:predicted_tokens_seconds_total counter
llamacpp:predicted_tokens_seconds_total 23.4
# TYPE llamacpp:kv_cache_usage_ratio gauge
llamacpp:kv_cache_usage_ratio 0.42
# TYPE llamacpp:memory_used_bytes gauge
llamacpp:memory_used_bytes 6871947673
`;

Bun.serve({
	port,
	idleTimeout: 30,
	fetch(req) {
		const path = new URL(req.url).pathname;
		if (path === "/health") {
			if (Date.now() - startedAt < health503Ms) {
				return new Response('{"status":"loading model"}', {
					status: 503,
					headers: { "content-type": "application/json" },
				});
			}
			return Response.json({ status: "ok", slots_idle: 2 });
		}
		if (path === "/slots") return Response.json(CANNED_SLOTS);
		if (path === "/metrics") {
			return new Response(
				metricsMalformed ? "\xff\xfe garbage {" : CANNED_METRICS,
				{
					headers: { "content-type": "text/plain" },
				},
			);
		}
		return new Response(null, { status: 404 });
	},
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
