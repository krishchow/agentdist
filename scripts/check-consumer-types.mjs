// Typecheck a small consumer against the packed tarball, the way a published install sees it:
// NodeNext resolution and no skipLibCheck. If the declarations stop resolving, every import turns
// into `any`, the deliberately wrong lines below stop erroring, and tsc fails on the unused
// `@ts-expect-error` (TS2578). Runs after the build; installs nothing, linking the repo's own
// copies of the package's dependencies instead.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repo = new URL("..", import.meta.url).pathname;
const pkgJson = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));

const PROBE = `import { type Env, type Package, PACK_TARGETS, type PackOutput, realEnv, runCli, runPack } from "agentdist";

const env: Env = realEnv();
declare const pkg: Package;
const result = runPack(pkg, PACK_TARGETS);
export const changed: string[] = result.changes.map((change) => change.path);
export const output: PackOutput = { files: [] };

// @ts-expect-error: an Env is not a number
export const notEnv: number = env;
// @ts-expect-error: a function is not a number
export const notPack: number = runPack;
// @ts-expect-error: runCli takes options, not an argv string
void runCli("install");
`;

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "nodenext",
    moduleResolution: "nodenext",
    lib: ["ES2023"],
    types: ["node"],
    strict: true,
    skipLibCheck: false,
    noEmit: true,
  },
  files: ["probe.ts"],
};

const dir = mkdtempSync(join(tmpdir(), "agentdist-consumer-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", dir], { cwd: repo, stdio: "ignore" });
  const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack produced no tarball");

  const installed = join(dir, "node_modules", pkgJson.name);
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", join(dir, tarball), "-C", installed, "--strip-components=1"]);
  for (const dep of [...Object.keys(pkgJson.dependencies ?? {}), "@types/node"]) {
    const link = join(dir, "node_modules", dep);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(realpathSync(join(repo, "node_modules", dep)), link);
  }

  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module", private: true }));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG));
  writeFileSync(join(dir, "probe.ts"), PROBE);
  execFileSync(join(repo, "node_modules", ".bin", "tsc"), ["-p", dir], { stdio: "inherit" });
  console.log("consumer types: ok (nodenext, skipLibCheck false)");
} catch (error) {
  if (error.status === undefined) throw error;
  console.error("consumer types: failed; the published declarations do not typecheck under nodenext");
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
