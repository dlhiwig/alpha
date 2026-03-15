# SuperClaw Skill Schema

## Overview

Skills define what the swarm can do. The router uses skill definitions to match user intent to the right agent configuration.

## Skill Definition Format

Each skill is a YAML file in `/src/skills/`:

```yaml
# skill-name.skill.yaml
id: unique-skill-id
name: Human Readable Name
version: 1.0.0

# For classifier matching
triggers:
  keywords: [word1, word2, word3]
  patterns:
    - "regex pattern.*"
  examples:
    - "Example user input that should trigger this skill"

# Agent configuration
agents:
  required:
    - role: architect
      focus: "High-level design and structure"
    - role: coder
      focus: "Implementation details"
  optional:
    - role: reviewer
      focus: "Quality assurance"
      condition: "complexity > 3"

# Input/Output
input:
  required:
    - name: objective
      type: string
      description: "What to accomplish"
  optional:
    - name: context
      type: string
      description: "Additional context"

output:
  format: markdown | json | code
  sections:
    - name: summary
      required: true
    - name: implementation
      required: false

# Execution hints
hints:
  maxAgents: 5
  timeout: 120000
  model: claude-sonnet-4-20250514
  parallel: true
```

## Skill Registry

The router loads all `.skill.yaml` files from `/src/skills/` at startup.

```typescript
interface SkillRegistry {
  skills: Map<string, SkillDefinition>;
  match(input: string): SkillMatch | null;
  get(id: string): SkillDefinition | null;
}
```

## Matching Priority

1. **Exact keyword match** — fastest, most reliable
2. **Pattern (regex) match** — for structured inputs
3. **Example similarity** — LLM-based fallback
4. **Default skill** — catch-all for unmatched inputs

## Built-in Skills

| Skill ID | Purpose |
|----------|---------|
| analyze | Code/document analysis |
| implement | Write new code |
| review | Code review and security audit |
| document | Generate documentation |
| research | Information gathering |
| plan | Strategic planning and roadmaps |
