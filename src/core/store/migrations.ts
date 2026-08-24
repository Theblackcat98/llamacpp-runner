/**
 * Forward-only schema migrations keyed by the version field (§5, P4-FR-14).
 * v1 documents (pre-schema, no version field) normalize to schema v2.
 */

export const CURRENT_VERSION = 2;

type AnyDoc = Record<string, unknown>;

function v1ToV2(doc: AnyDoc): AnyDoc {
	const presets = Array.isArray(doc.presets) ? doc.presets : [];
	return {
		...doc,
		$schema: "./schema.preset.json",
		version: 2,
		presets: (presets as AnyDoc[]).map((p) => ({
			...p,
			env_vars: p.env_vars && typeof p.env_vars === "object" ? p.env_vars : {},
			created_at:
				typeof p.created_at === "string"
					? p.created_at
					: typeof p.created === "string"
						? p.created
						: new Date(0).toISOString(),
			last_used: typeof p.last_used === "string" ? p.last_used : null,
		})),
	};
}

/**
 * Apply forward migrations until the document reaches CURRENT_VERSION.
 * Documents already at/after current pass through with $schema ensured.
 */
export function migrate<T extends object>(doc: T): T & { $schema: string } {
	let current = doc as AnyDoc;
	let version =
		typeof current.version === "number" ? (current.version as number) : 1;

	while (version < CURRENT_VERSION) {
		if (version === 1) {
			current = v1ToV2(current);
			version = 2;
		} else {
			// Unknown future version: stop, keep verbatim (forward-only rule).
			break;
		}
	}
	current.$schema ??= "./schema.preset.json";
	return current as T & { $schema: string };
}
