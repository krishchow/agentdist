import { z } from "zod";
import { dialect, proseToolRef } from "../harness/dialect.js";
import { codexMcpEntry } from "../harnesses/codex.js";
import { pluginContent } from "./content.js";
import { json, type PackTarget } from "./types.js";

const Options = z.strictObject({
  /**
   * Where the plugin's MCP server config is written. Not `.mcp.json` by default: Claude Code reads
   * a root `.mcp.json` as project servers, which would register the server twice in the package's
   * own repository.
   */
  mcpFile: z.string().default("codex.mcp.json"),
  /** What the plugin does to the workspace, shown in the Codex plugin directory. */
  capabilities: z.array(z.string()).optional(),
  /** Also write `.agents/plugins/marketplace.json`, making the repository its own marketplace. */
  marketplace: z
    .strictObject({
      name: z.string().optional(),
      displayName: z.string().optional(),
      pluginDisplayName: z.string().optional(),
      policy: z.record(z.string(), z.string()).optional(),
    })
    .or(z.boolean())
    .default(true),
  contentDir: z.string().default("plugins/codex"),
});

/**
 * A Codex plugin: `.codex-plugin/plugin.json`, its MCP server file, and a repository marketplace.
 * https://developers.openai.com/codex/plugins
 */
export const codexPlugin: PackTarget = {
  id: "codex-plugin",
  label: "Codex plugin",
  pack(pkg, raw) {
    const options = Options.parse(raw);
    const { manifest } = pkg;
    const listing = manifest.listing;
    const content = pluginContent(pkg, {
      id: "codex-plugin",
      outDir: options.contentDir,
      dialect: dialect({
        toolRef: proseToolRef,
        skillRef: (name) => `$${name}`,
        commandRef: (name) => `/${name}`,
      }),
      showPath: (rel) => `<plugin root>/${rel}`,
    });
    const servers = pkg.nodes.filter((n) => n.kind === "mcpServer");
    const notes = pkg.nodes
      .filter((n) => n.kind === "hook")
      .map((n) => `hook "${n.name}" is left out: this target does not write plugin hooks yet`);
    const onboarding = manifest.onboardingSkill;
    const displayName = listing?.displayName ?? pkg.name;

    const plugin = {
      name: pkg.name,
      version: pkg.version,
      description: manifest.description,
      author: listing?.author,
      homepage: listing?.homepage,
      repository: listing?.repository,
      license: listing?.license,
      keywords: listing?.keywords.length ? listing.keywords : undefined,
      skills: content.skills,
      mcpServers: servers.length ? `./${options.mcpFile}` : undefined,
      extensions:
        onboarding && content.skills
          ? { "com.openai": { onboardingSkill: `${content.skills}${onboarding}/SKILL.md` } }
          : undefined,
      interface: {
        displayName,
        shortDescription: listing?.shortDescription,
        longDescription: listing?.longDescription,
        developerName: listing?.author?.name,
        category: listing?.category,
        capabilities: options.capabilities,
        websiteURL: listing?.homepage,
        defaultPrompt: listing?.defaultPrompts.length ? listing.defaultPrompts : undefined,
        brandColor: listing?.brandColor,
      },
    };
    const files = [{ path: ".codex-plugin/plugin.json", content: json(plugin) }, ...content.files];
    if (servers.length) {
      const entries: Record<string, unknown> = {};
      for (const server of servers) {
        if (server.transport === "stdio") entries[server.name] = codexMcpEntry(server);
        // A plugin's MCP file is documented for remote servers only as a type and a URL.
        else if (Object.keys(server.headers).length === 0)
          entries[server.name] = { type: "http", url: server.url };
        else
          notes.push(
            `remote server "${server.name}" is left out: how a plugin's MCP file carries headers is not documented`,
          );
      }
      files.push({ path: options.mcpFile, content: json({ mcpServers: entries }) });
    }
    if (options.marketplace !== false) {
      const market = options.marketplace === true ? {} : options.marketplace;
      files.push({
        path: ".agents/plugins/marketplace.json",
        content: json({
          name: market.name ?? pkg.name,
          interface: { displayName: market.displayName ?? displayName },
          plugins: [
            {
              name: pkg.name,
              source: { source: "local", path: "./" },
              policy: market.policy,
              category: listing?.category,
              interface: { displayName: market.pluginDisplayName ?? displayName },
            },
          ],
        }),
      });
    }
    return { files, ownedDirs: content.ownedDirs, notes };
  },
};
