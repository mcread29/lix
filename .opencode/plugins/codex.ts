import { Plugin, tool } from "@opencode-ai/plugin";
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
} as const;

const runCodex = async (prompt: string, threadID?: string | undefined) => {
  const thread = threadID ? codex.resumeThread(threadID) : codex.startThread();
  return await thread.run(prompt, { outputSchema: schema });
};

export const CodexPlugin: Plugin = async () => {
  return {
    tool: {
      codex: tool({
        description: "spawn a codex agent for a specific task",
        args: {
          context: tool.schema.string().describe("information needed for task"),
          task: tool.schema
            .string()
            .describe("task to be completed by the agent"),
          constraints: tool.schema
            .string()
            .describe("what NOT to do, parameters, musts and nevers"),
          output: tool.schema
            .string()
            .describe("what the result of the function/script/task should be"),
        },
        async execute(args) {
          const prompt = `
<context>
${args.context}
</context>

<task>
${args.task}
</task>

<constraints>
${args.constraints}
</constraints>

<output>
${args.output}
</output>
          `;
          const turn = await runCodex(prompt);
          return turn.finalResponse;
        },
      }),
    },
  };
};
