/** Skills index — scans installed OpenClaw skills, Codex agents, Hermes skills */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  type: "openclaw" | "superpowers" | "codex" | "hermes";
}

export async function scanInstalledSkills(): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  const sources = [
    {
      dir: path.join(os.homedir(), ".openclaw/workspace/skills"),
      type: "openclaw" as const,
      ext: "SKILL.md",
    },
    { dir: "/home/toba/hermes/.claude/skills", type: "hermes" as const, ext: "SKILL.md" },
    { dir: path.join(os.homedir(), ".codex/agents"), type: "codex" as const, ext: ".toml" },
  ];
  for (const { dir, type, ext } of sources) {
    try {
      for (const entry of await fs.readdir(dir)) {
        try {
          const filePath = ext === ".toml" ? path.join(dir, entry) : path.join(dir, entry, ext);
          if (ext === ".toml" && !entry.endsWith(".toml")) {
            continue;
          }
          const content = await fs.readFile(filePath, "utf-8");
          const desc = content.match(/description[:\s=]+["']?(.+?)["']?$/m)?.[1]?.trim() ?? entry;
          const name = ext === ".toml" ? entry.replace(".toml", "") : entry;
          skills.push({
            name,
            description: desc,
            triggers: desc
              .toLowerCase()
              .split(/[\s,;:]+/)
              .filter((w) => w.length > 3)
              .slice(0, 8),
            type,
          });
        } catch {
          /* skip */
        }
      }
    } catch {
      /* dir not found */
    }
  }
  console.log(`[SkillsIndex] Scanned ${skills.length} installed skills`);
  return skills;
}
