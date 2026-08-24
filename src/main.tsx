import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/app";

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
