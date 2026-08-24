export type ParseErrorCode =
	| "BAD_MAGIC"
	| "UNSUPPORTED_VERSION"
	| "TRUNCATED"
	| "HEADER_TOO_LARGE";

export class ParseError extends Error {
	readonly code: ParseErrorCode;

	constructor(code: ParseErrorCode, detail?: string) {
		super(detail ? `${code}: ${detail}` : code);
		this.name = "ParseError";
		this.code = code;
	}
}

/** Internal: reader ran out of buffered bytes before the header completed. */
export class NeedMoreBytes extends Error {}
