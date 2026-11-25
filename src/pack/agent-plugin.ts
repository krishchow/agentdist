import { z } from "zod";
import { compactEntry, headerEnv } from "../surfaces/mcp.js";
import { usesRefs } from "./content.js";
import { json, type PackTarget } from "./types.js";

const SPEC = "https://agent-plugins.org/schemas/1.0.0";

const Options = z.strictObject({
  /** Codex reads its listing and onboarding skill from `extensions["com.openai"]`. */
  codex: z
    .strictObject({ capabilities: z.array(z.string()).optional() })
    .or(z.boolean())
    .default(true),
});

/**
 * The vendor-neutral Agent Plugins format: a root `plugin.json` and `mcp.json` beside `skills/`.
 * Codex, Cursor, Copilot, Qwen and others load it as it is. https://agent-plugins.org/specification
 *
 * The format fixes where things are and what they may be, so a package has to fit it:
 * skills live in `./skills`, and only skills and MCP servers are carried. A root `plugin.json`
 * also changes how some harnesses read the rest of the repository: Copilot and Codex then load
 * only what this format defines, and Codex ignores a `.codex-plugin` manifest's own MCP file.
 */
export const agentPlugin: PackTarget = {
  id: "agent-plugin",
  label: "Agent Plugin (agent-plugins.org)",
  pack(pkg, raw) {
    const options = Options.parse(raw);
    const { manifest } = pkg;
    const listing = manifest.listing;
    const skillsDir = manifest.skills?.replace(/^\.\//, "").replace(/\/$/, "");
    if (skillsDir !== undefined && skillsDir !== "skills") {
      throw new Error(
        `agent-plugin: skills must be in ./skills, not ${manifest.skills}; the format does not allow another location`,
      );
    }
    if (usesRefs(pkg)) {
      throw new Error(
        "agent-plugin: the package uses symbolic references, which this format has no dialect to render into",
      );
    }
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(pkg.name) || pkg.name.length > 64) {
      throw new Error(`agent-plugin: "${pkg.name}" is not a valid plugin name in this format`);
    }
    const notes: string[] = [];
    const servers: Record<string, unknown> = {};
    for (const node of pkg.nodes) {
      if (node.kind === "hook") {
        notes.push(`hook "${node.name}" is left out: the format carries only skills and MCP servers`);
      } else if (node.kind === "mcpServer" && node.transport === "stdio") {
        servers[node.name] = compactEntry({
          type: "stdio",
          command: node.command,
          args: node.args,
          env: node.env,
        });
        if (node.envPassthrough.length) {
          notes.push(
            `server "${node.name}": the format cannot name the variables a server needs (${node.envPassthrough.join(", ")}); each client decides what it inherits`,
          );
        }
      } else if (node.kind === "mcpServer") {
        // Clients must not expand anything in a remote server's headers, so a header that needs a
        // variable cannot be expressed, and writing the credential itself is not an option.
        if (headerEnv(node).length) {
          notes.push(
            `server "${node.name}" is left out: the format's header values are literal, and it needs ${headerEnv(node).join(", ")}`,
          );
        } else {
          servers[node.name] = compactEntry({
            type: "streamable-http",
            url: node.url,
            headers: node.headers,
          });
        }
      }
    }
    const onboarding = manifest.onboardingSkill;
    const codex = options.codex === false ? undefined : options.codex === true ? {} : options.codex;

    const plugin = {
      $schema: `${SPEC}/plugin.schema.json`,
      name: pkg.name,
      version: pkg.version,
      description: manifest.description,
      author: listing?.author,
      homepage: listing?.homepage,
      repository: listing?.repository,
      license: listing?.license,
      keywords: listing?.keywords.length ? listing.keywords : undefined,
      extensions: codex
        ? {
            "com.openai": {
              onboardingSkill: onboarding ? `./skills/${onboarding}/SKILL.md` : undefined,
              interface: {
                displayName: listing?.displayName ?? pkg.name,
                shortDescription: listing?.shortDescription,
                longDescription: listing?.longDescription,
                developerName: listing?.author?.name,
                category: listing?.category,
                capabilities: codex.capabilities,
                websiteURL: listing?.homepage,
                defaultPrompt: listing?.defaultPrompts.length ? listing.defaultPrompts : undefined,
                brandColor: listing?.brandColor,
              },
            },
          }
        : undefined,
    };
    const files = [{ path: "plugin.json", content: json(plugin) }];
    if (Object.keys(servers).length) {
      files.push({
        path: "mcp.json",
        content: json({ $schema: `${SPEC}/mcp.schema.json`, mcpServers: servers }),
      });
    }
    return { files, notes };
  },
};
