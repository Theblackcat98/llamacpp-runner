import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/app";
import { TOKYO_NIGHT } from "./ui/theme";

const renderer = await createCliRenderer();
createRoot(renderer).render(
	<App theme={TOKYO_NIGHT} onQuit={() => renderer.destroy()} />,
);
