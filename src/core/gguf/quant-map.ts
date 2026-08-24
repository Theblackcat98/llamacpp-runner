/**
 * general.file_type enum (ggml ftype) → human quant name.
 * Table-driven so new quants are one-line additions (PRD §11).
 */
const QUANT_MAP: Record<number, string> = {
	0: "F32",
	1: "F16",
	2: "Q4_0",
	3: "Q4_1",
	7: "Q8_0",
	8: "Q5_0",
	9: "Q5_1",
	10: "Q2_K",
	11: "Q3_K_S",
	12: "Q3_K_M",
	13: "Q3_K_L",
	14: "Q4_K_S",
	15: "Q4_K_M",
	16: "Q5_K_S",
	17: "Q5_K_M",
	18: "Q6_K",
	19: "IQ2_XXS",
	20: "IQ2_XS",
	21: "Q2_K_S",
	22: "IQ3_XS",
	23: "IQ3_XXS",
	24: "IQ1_S",
	25: "IQ4_NL",
	26: "IQ3_S",
	27: "IQ3_M",
	28: "IQ4_XS",
	29: "I8",
	30: "IQ1_M",
	31: "BF16",
	36: "TQ1_0",
	37: "TQ2_0",
};

export function quantName(fileType: number | undefined): string {
	if (fileType === undefined) return "UNKNOWN";
	return QUANT_MAP[fileType] ?? `UNKNOWN(${fileType})`;
}
