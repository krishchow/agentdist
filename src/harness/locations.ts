import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Env, Loc } from "./define";

/** `~/<dir>`, unless one of `envVars` relocates it. */
export function dotHome(dir: string, ...envVars: string[]): (env: Env) => string {
  return (env) => fromEnv(env, envVars) ?? join(env.home, dir);
}

/** `$XDG_CONFIG_HOME/<name>` (default `~/.config/<name>`), unless one of `envVars` relocates it. */
export function xdgConfig(name: string, ...envVars: string[]): (env: Env) => string {
  return (env) => {
    const xdg = env.vars.XDG_CONFIG_HOME;
    return fromEnv(env, envVars) ?? join(xdg && isAbsolute(xdg) ? xdg : join(env.home, ".config"), name);
  };
}

function fromEnv(env: Env, names: string[]): string | undefined {
  for (const name of names) {
    const value = env.vars[name];
    if (value && isAbsolute(value)) return value;
  }
  return undefined;
}

/** Under the user's home directory, whatever the harness's own config directory is. */
export const inHome =
  (...segments: string[]): Loc =>
  ({ env }) =>
    join(env.home, ...segments);

/** Under the repository root. */
export const inProject =
  (...segments: string[]): Loc =>
  ({ env }) =>
    join(env.projectRoot, ...segments);

/** Under the harness's own config directory at the scope being planned. */
export const inConfig =
  (...segments: string[]): Loc =>
  ({ configRoot }) =>
    join(configRoot, ...segments);

/** The usual "is it installed" test: the harness's user config directory exists. */
export function configRootExists(root: (env: Env) => string): (env: Env) => boolean {
  return (env) => existsSync(root(env));
}
