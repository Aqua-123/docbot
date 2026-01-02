import { z } from "zod"

const inputSchema = z.object({
  context: z
    .string()
    .optional()
    .describe("additional context to help the user answer"),
  defaultAnswer: z
    .string()
    .optional()
    .describe("suggested default if the user doesn't have a preference"),
  options: z
    .array(z.string())
    .optional()
    .describe("if applicable, specific options the user can choose from"),
  question: z.string().describe("the question to ask the user"),
})

/**
 * tool for asking the user a question during agent execution
 *
 * in interactive mode, this returns a prompt that tells the LLM to wait
 * for the user's response before continuing. the LLM should present the
 * question to the user and then stop, waiting for their reply.
 *
 * in non-interactive mode, uses the default answer if provided, or skips.
 */
export const createAskUserTool = (interactive: boolean) => ({
  description:
    "ask the user a question and wait for their response. " +
    "use this when you need clarification, approval, or input from the user. " +
    "after calling this tool, present the question to the user and wait for their reply.",
  execute: ({
    question,
    context,
    options,
    defaultAnswer,
  }: z.infer<typeof inputSchema>) => {
    if (!interactive) {
      return {
        answer: defaultAnswer ?? "",
        reason: "running in non-interactive mode",
        skipped: true,
      }
    }

    // return information for the LLM to present to the user
    // the LLM should then stop and wait for user input
    return {
      context: context ?? null,
      defaultAnswer: defaultAnswer ?? null,
      instruction:
        "Present this question to the user and STOP. Wait for their response before continuing.",
      options: options ?? null,
      question,
      status: "awaiting_user_response",
    }
  },
  inputSchema,
})
