import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, SkillMatch, SkillRegistry } from './types';

// Create skill registry from JSON files
export function createRegistry(skillsDir: string): SkillRegistry {
  const skills = new Map<string, SkillDefinition>();

  // Load all .skill.json files
  if (fs.existsSync(skillsDir)) {
    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.skill.json'));
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
        const skill = JSON.parse(content) as SkillDefinition;
        if (skill.id) {
          skills.set(skill.id, skill);
          console.log(`[Registry] ✅ Loaded skill: ${skill.id}`);
        }
      } catch (error: unknown) {
        console.error(`[Registry] ❌ Failed to load ${file}:`, error);
      }
    }
  }

  console.log(`[Registry] Total skills loaded: ${skills.size}`);

  return {
    skills,

    match(input: string): SkillMatch | null {
      const inputLower = input.toLowerCase();
      let bestMatch: SkillMatch | null = null;

      for (const skill of skills.values()) {
        // 1. Keyword match (highest confidence)
        if (skill.triggers?.keywords) {
          for (const keyword of skill.triggers.keywords) {
            if (inputLower.includes(keyword.toLowerCase())) {
              const confidence = 0.9;
              if (!bestMatch || confidence > bestMatch.confidence) {
                bestMatch = {
                  skill,
                  confidence,
                  matchType: 'keyword',
                  matchedOn: keyword,
                };
              }
            }
          }
        }

        // 2. Pattern match
        if (skill.triggers?.patterns) {
          for (const pattern of skill.triggers.patterns) {
            try {
              const regex = new RegExp(pattern, 'i');
              if (regex.test(input)) {
                const confidence = 0.85;
                if (!bestMatch || confidence > bestMatch.confidence) {
                  bestMatch = {
                    skill,
                    confidence,
                    matchType: 'pattern',
                    matchedOn: pattern,
                  };
                }
              }
            } catch {
              // Invalid regex, skip
            }
          }
        }
      }

      // 3. Default to analyze skill if no match
      if (!bestMatch) {
        const defaultSkill = skills.get('analyze');
        if (defaultSkill) {
          bestMatch = {
            skill: defaultSkill,
            confidence: 0.5,
            matchType: 'default',
          };
        }
      }

      return bestMatch;
    },

    get(id: string): SkillDefinition | null {
      return skills.get(id) || null;
    },

    list(): SkillDefinition[] {
      return Array.from(skills.values());
    },
  };
}

// Export default registry pointing to skills directory
const SKILLS_DIR = path.join(__dirname);
export const registry = createRegistry(SKILLS_DIR);
