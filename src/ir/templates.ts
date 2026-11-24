/**
 * The two placeholders that appear in manifest strings rather than in content.
 *
 *   {{env:NAME}}    in an HTTP server's header value: a variable from the user's environment
 *   {{hooks_dir}}   in a hook's command: where the package's hook files are installed
 */

const ENV = /\{\{\s*env:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const HOOKS_DIR = /\{\{\s*hooks_dir\s*\}\}/g;

/** The environment variables a string refers to. */
export function envRefs(value: string): string[] {
  return [...value.matchAll(ENV)].map((m) => m[1] as string);
}

export function renderEnvRefs(value: string, render: (name: string) => string): string {
  return value.replace(ENV, (_whole, name: string) => render(name));
}

export function usesHooksDir(value: string): boolean {
  HOOKS_DIR.lastIndex = 0;
  return HOOKS_DIR.test(value);
}

export function renderHooksDir(value: string, dir: string): string {
  return value.replace(HOOKS_DIR, dir);
}
