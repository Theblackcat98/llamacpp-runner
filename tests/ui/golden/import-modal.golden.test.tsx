import { describe, it } from "bun:test";
import { ImportModal } from "../../../src/ui/components/import-modal";
import { DEFAULT_THEME } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

describe("import modal golden frames", () => {
	it("renders open import modal in empty awaiting input state", async () => {
		await expectGoldenFrame(
			"import-modal-empty",
			<ImportModal
				theme={DEFAULT_THEME}
				open={true}
				onClose={() => {}}
				onImport={() => {}}
			/>,
			{ width: 100, height: 20 },
		);
	});

	it("closed import modal renders nothing", async () => {
		await expectGoldenFrame(
			"import-modal-closed",
			<ImportModal
				theme={DEFAULT_THEME}
				open={false}
				onClose={() => {}}
				onImport={() => {}}
			/>,
			{ width: 100, height: 20 },
		);
	});
});
