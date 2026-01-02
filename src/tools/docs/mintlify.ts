import { createMCPClient } from "@ai-sdk/mcp"
import { z } from "zod"

const inputSchema = z.object({
  query: z
    .string()
    .describe(
      "search query to find mintlify features, components, examples, or API references",
    ),
})

/**
 * cached MCP client for mintlify docs
 * initialized lazily on first use
 */
let mintlifyMcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null
let mintlifyTools: Awaited<
  ReturnType<Awaited<ReturnType<typeof createMCPClient>>["tools"]>
> | null = null

/**
 * get or create the mintlify mcp tools
 */
async function getMintlifyTools() {
  if (!mintlifyMcpClient) {
    mintlifyMcpClient = await createMCPClient({
      transport: {
        type: "http",
        url: "https://mintlify.com/docs/mcp",
      },
    })
  }

  if (!mintlifyTools) {
    mintlifyTools = await mintlifyMcpClient.tools()
  }

  return mintlifyTools
}

/**
 * create a wrapper tool for searching mintlify docs
 */
export const createSearchMintlifyTool = () => ({
  description:
    "search mintlify documentation for features, components, examples, and api references. use this to discover mintlify capabilities like custom components, mdx features, tabs, accordions, code blocks, cards, callouts, and more. this helps you write richer, more interactive documentation.",
  execute: async ({ query }: z.infer<typeof inputSchema>) => {
    try {
      const tools = await getMintlifyTools()
      const searchTool = tools.SearchMintlify

      if (!searchTool?.execute) {
        return {
          error: "mintlify search tool not available",
          success: false,
        }
      }

      // forward to the MCP tool (it expects params and options)
      // we pass minimal options since we don't have the full context
      const result = await searchTool.execute(
        { query },
        { messages: [], toolCallId: "mintlify-search" },
      )

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return {
        error: `mintlify search failed: ${message}`,
        success: false,
      }
    }
  },
  inputSchema,
})
