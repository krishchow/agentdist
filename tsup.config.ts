import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: true,
  sourcemap: false,
  // dist/cli.js is the package's bin; the shebang is harmless on the library entry.
  banner: { js: "#!/usr/bin/env node" },
});
