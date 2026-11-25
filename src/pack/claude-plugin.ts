import { z } from "zod";
import { dialect } from "../harness/dialect.js";
import type { Package } from "../ir/nodes.js";
import { renderHooksDir } from "../ir/templates.js";
import type { JsonValue } from "../ops/types.js";
import { claudeStyleHook } from "../surfaces/hooks.js";
import { compactEntry, entryHeaders } from "../surfaces/mcp.js";
import { pluginContent } from "./content.js";
import { json, type PackTarget } from "./types.js";

const Options = z.strictObject({
  /** Also write `.claude-plugin/marketplace.json`, making the repository its own marketplace. */
  marketplace: z
    .strictObject({ name: z.string().optional(), description: z.string().optional() })
    .or(z.boolean())
    .default(true),
  /** Where rendered content goes when the package uses symbolic references. */
  contentDir: z.string().default("plugins/claude"),
});

const envRef = (name: string) => `\${${name}}`;

function mcpServers(pkg: Package) {
  return Object.fromEntries(
    pkg.nodes
      .filter((n) => n.kind === "mcpServer")
      .map((s) => [
        s.name,
        s.transport === "stdio"
          ? compactEntry({ command: s.command, args: s.args, env: s.env })
          : compactEntry({ type: "http", url: s.url, headers: entryHeaders(s, envRef) }),
      ]),
  );
}

/** `hooks.json` in Claude Code's own shape, with commands pointed at the plugin's install directory. */
function hooksFile(pkg: Package) {
  const hooks: Record<string, JsonValue[]> = {};
  const dir = `"\${CLAUDE_PLUGIN_ROOT}/${(pkg.manifest.hooksDir ?? "").replace(/^\.\//, "").replace(/\/$/, "")}"`;
  for (const node of pkg.nodes) {
    if (node.kind !== "hook") continue;
    const hook = claudeStyleHook({
      name: node.name,
      event: node.event,
      tools: node.matcher,
      command: renderHooksDir(node.command, dir),
      timeoutSec: node.timeoutSec,
    });
    hooks[node.event] = [...(hooks[node.event] ?? []), hook];
  }
  return Object.keys(hooks).length ? { hooks } : undefined;
}

/**
 * A Claude Code plugin: `.claude-plugin/plugin.json`, with the repository doubling as a
 * single-plugin marketplace. https://code.claude.com/docs/en/plugins-reference
 */
export const claudePlugin: PackTarget = {
  id: "claude-plugin",
  label: "Claude Code plugin",
  pack(pkg, raw) {
    const options = Options.parse(raw);
    const { manifest } = pkg;
    const listing = manifest.listing;
    const content = pluginContent(pkg, {
      id: "claude-plugin",
      outDir: options.contentDir,
      // A plugin's servers and skills are namespaced by the plugin's name.
      dialect: dialect({
        toolRef: (server, tool) => `mcp__plugin_${pkg.name}_${server}__${tool}`,
        skillRef: (name) => `/${pkg.name}:${name}`,
        commandRef: (name) => `/${pkg.name}:${name}`,
        agentRef: (name) => `\`${pkg.name}:${name}\``,
      }),
      showPath: (rel) => `\${CLAUDE_PLUGIN_ROOT}/${rel}`,
    });
    // Claude Code finds ./skills, ./agents and ./commands by itself; only other locations are named.
    const elsewhere = (path: string | undefined, standard: string) =>
      path && path !== standard ? path : undefined;
    const servers = mcpServers(pkg);
    const hooks = hooksFile(pkg);
    const HOOKS_FILE = ".claude-plugin/hooks.json";

    const plugin = {
      name: pkg.name,
      version: pkg.version,
      description: manifest.description,
      author: listing?.author,
      homepage: listing?.homepage,
      repository: listing?.repository,
      license: listing?.license,
      keywords: listing?.keywords.length ? listing.keywords : undefined,
      skills: elsewhere(content.skills, "./skills/"),
      agents: elsewhere(content.agents, "./agents/"),
      commands: elsewhere(content.commands, "./commands/"),
      hooks: hooks ? `./${HOOKS_FILE}` : undefined,
      mcpServers: Object.keys(servers).length ? servers : undefined,
    };
    const files = [{ path: ".claude-plugin/plugin.json", content: json(plugin) }, ...content.files];
    if (hooks) files.push({ path: HOOKS_FILE, content: json(hooks) });

    if (options.marketplace !== false) {
      const market = options.marketplace === true ? {} : options.marketplace;
      files.push({
        path: ".claude-plugin/marketplace.json",
        content: json({
          name: market.name ?? pkg.name,
          owner: listing?.author ? { name: listing.author.name } : undefined,
          plugins: [
            {
              name: pkg.name,
              source: "./",
              description: market.description ?? listing?.shortDescription ?? manifest.description,
            },
          ],
        }),
      });
    }
    return { files, ownedDirs: content.ownedDirs };
  },
};
