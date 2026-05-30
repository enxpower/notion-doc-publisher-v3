import fs from "node:fs/promises";
import { runCli } from "../config.js";

await runCli(async () => {
  await fs.rm("dist", { recursive: true, force: true });
  console.log("Removed dist/.");
});
