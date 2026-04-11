import type { AgentSkill, AgentTool } from "./types.js";

/**
 * Define a skill — a high-level strategy that the agent can activate.
 *
 * Skills differ from tools:
 * - Tools are operations with defined inputs/outputs (read_file, run_command)
 * - Skills are strategies/guidance for how to approach a class of problems
 *
 * When the agent activates a skill via the `activate_skill` tool,
 * the skill's prompt is injected into the conversation as strategic guidance.
 */
export function defineSkill(def: AgentSkill): AgentSkill {
  return {
    source: "developer",
    utility: 1.0,
    ...def,
  };
}

/**
 * Create the `activate_skill` meta-tool that lets the agent activate a skill
 * and receive its guidance text injected into the conversation.
 *
 * The returned tool is concurrency-safe (read-only lookup) and soft-failure.
 */
export function createActivateSkillTool(skills: AgentSkill[]): AgentTool {
  const skillMap = new Map(skills.map((s) => [s.name, s]));

  return {
    name: "activate_skill",
    description:
      "Activate a skill by name to receive specialized guidance. "
      + "Available skills: "
      + skills.map((s) => `${s.name} (${s.trigger})`).join(", "),
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "The name of the skill to activate",
        },
      },
      required: ["skill_name"],
    },
    isConcurrencySafe: true,
    failureMode: "soft",
    async execute(args) {
      const name = args.skill_name as string | undefined;
      if (!name) {
        return { error: "skill_name is required" };
      }
      const skill = skillMap.get(name);
      if (!skill) {
        return {
          error: `Skill "${name}" not found. Available: ${[...skillMap.keys()].join(", ")}`,
        };
      }
      return {
        skill: skill.name,
        description: skill.description,
        guidance: skill.prompt,
        preferredTools: skill.tools ?? [],
      };
    },
  };
}

/**
 * Format skill descriptions for inclusion in the system prompt.
 */
export function formatSkillDescriptions(skills: AgentSkill[]): string {
  if (skills.length === 0) return "";
  return (
    "## Available Skills\n\n"
    + "You can activate specialized skills using the `activate_skill` tool.\n\n"
    + skills.map((s) => `- **${s.name}**: ${s.trigger}`).join("\n")
  );
}
