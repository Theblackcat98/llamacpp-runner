import { describe, it } from "bun:test";
import { Badge } from "../../../src/ui/components/badge";
import { TuiBox } from "../../../src/ui/components/box";
import { Gauge, Sparkline } from "../../../src/ui/components/gauge";
import { Spinner } from "../../../src/ui/components/spinner";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

function Demo() {
	return (
		<TuiBox theme={TOKYO_NIGHT} variant="double" title="display" accent>
			<Gauge theme={TOKYO_NIGHT} value={0.62} label="load" width={10} />
			<Sparkline
				theme={TOKYO_NIGHT}
				values={[0.1, 0.4, 0.65, 0.3, 0.9]}
				label="tps"
			/>
			<Spinner
				theme={TOKYO_NIGHT}
				style="braille"
				tickOverride={0}
				label="loading"
			/>
			<Badge theme={TOKYO_NIGHT} status="ok" label="healthy" />
			<Badge theme={TOKYO_NIGHT} status="warn" label="warm" />
			<Badge theme={TOKYO_NIGHT} status="error" label="fail" />
		</TuiBox>
	);
}

describe("display widgets golden frames (P2-FR-08,10,11,12)", () => {
	it("renders gauge, sparkline, spinner, badge, themed box", async () => {
		await expectGoldenFrame("display-widgets", <Demo />, {
			width: 44,
			height: 8,
		});
	});
});
