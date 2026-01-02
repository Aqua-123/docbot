import { z } from "zod"

const inputSchema = z.object({
  allowMultiple: z
    .boolean()
    .default(false)
    .describe("allow selecting multiple options"),
  options: z
    .array(
      z.object({
        description: z.string().optional().describe("additional context"),
        label: z.string().describe("the label to display"),
        value: z.string().describe("the value to return if selected"),
      }),
    )
    .min(2)
    .describe("the options to present"),
  question: z.string().describe("the question or prompt"),
})

/**
 * tool for presenting multiple choice options to the user
 */
export const createPresentOptionsTool = (interactive: boolean) => ({
  description: "present multiple options to the user and let them choose",
  execute: ({
    question,
    options,
    allowMultiple,
  }: z.infer<typeof inputSchema>) => {
    if (!interactive) {
      // in non-interactive mode, pick the first option
      return {
        reason: "running in non-interactive mode",
        selected: [options[0]!.value],
        skipped: true,
      }
    }

    // in interactive mode, emit event for UI
    return {
      allowMultiple,
      options,
      pending: true,
      question,
      selected: [],
      skipped: false,
    }
  },
  inputSchema,
})
