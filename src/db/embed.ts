import { embed, embedMany } from "ai"
import { logEmbed } from "../logger"

// rough estimate: ~1.2 chars per token for code (very conservative)
// code often has 1:1 or even more tokens than chars due to whitespace, operators, etc.
const CHARS_PER_TOKEN = 1.2
// max tokens per batch (leave significant headroom from 8192 limit)
const MAX_TOKENS_PER_BATCH = 6000
const MAX_CHARS_PER_BATCH = Math.floor(MAX_TOKENS_PER_BATCH * CHARS_PER_TOKEN)
// max chars for a single text (must be much smaller - code can be 1:1 token:char)
// 6000 chars ≈ 5000 tokens (safe margin)
const MAX_CHARS_PER_TEXT = 6000

function splitLinesIntoChunks(lines: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let currentChunk = ""

  for (const line of lines) {
    const exceedsLimit = currentChunk.length + line.length + 1 > maxChars
    if (exceedsLimit && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = line
      continue
    }

    currentChunk += (currentChunk ? "\n" : "") + line
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

function splitOversizedChunks(chunks: string[], maxChars: number): string[] {
  const finalChunks: string[] = []

  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      finalChunks.push(chunk)
      continue
    }

    for (let i = 0; i < chunk.length; i += maxChars) {
      finalChunks.push(chunk.slice(i, i + maxChars))
    }
  }

  return finalChunks
}

/**
 * split a large text into chunks that fit within the token limit
 */
function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const lineChunks = splitLinesIntoChunks(text.split("\n"), maxChars)
  return splitOversizedChunks(lineChunks, maxChars)
}

/**
 * embed a single text string
 *
 * @param text - The text to embed
 * @param embeddingModelId - The model ID for embeddings (e.g., "openai/text-embedding-3-small")
 */
export async function embedText(
  text: string,
  embeddingModelId: string,
): Promise<number[]> {
  const start = performance.now()

  const { embedding } = await embed({
    model: embeddingModelId,
    value: text,
  })

  logEmbed(
    `single embed (${text.length} chars) → ${embedding.length} dims`,
    performance.now() - start,
  )
  return embedding
}

function partitionTexts(texts: string[]) {
  const oversized: string[] = []
  const normal: string[] = []

  for (const text of texts) {
    if (text.length > MAX_CHARS_PER_TEXT) {
      oversized.push(text)
    } else {
      normal.push(text)
    }
  }

  return { normal, oversized }
}

async function embedValues(values: string[], embeddingModelId: string) {
  const { embeddings } = await embedMany({
    model: embeddingModelId,
    values,
  })
  return embeddings
}

async function embedOversizedTexts(
  oversized: string[],
  embeddingModelId: string,
): Promise<number[][]> {
  const embeddings: number[][] = []
  const BATCH_SIZE = 50

  for (const text of oversized) {
    const chunks = splitTextIntoChunks(text, MAX_CHARS_PER_TEXT)
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const batchEmbeddings = await embedValues(batch, embeddingModelId)
      embeddings.push(...batchEmbeddings)
    }
  }

  return embeddings
}

async function embedTextsInBatches(
  texts: string[],
  embeddingModelId: string,
): Promise<number[][]> {
  const embeddings: number[][] = []
  let currentBatch: string[] = []
  let currentBatchChars = 0

  for (const text of texts) {
    const textChars = text.length
    const exceedsBatchLimit =
      currentBatchChars + textChars > MAX_CHARS_PER_BATCH
    const batchNearlyFull = currentBatchChars > MAX_CHARS_PER_BATCH * 0.9

    if (textChars > MAX_CHARS_PER_TEXT) {
      if (currentBatch.length > 0) {
        embeddings.push(...(await embedValues(currentBatch, embeddingModelId)))
        currentBatch = []
        currentBatchChars = 0
      }
      embeddings.push(...(await embedValues([text], embeddingModelId)))
      continue
    }

    if (currentBatch.length > 0 && (exceedsBatchLimit || batchNearlyFull)) {
      embeddings.push(...(await embedValues(currentBatch, embeddingModelId)))
      currentBatch = []
      currentBatchChars = 0
    }

    currentBatch.push(text)
    currentBatchChars += textChars
  }

  if (currentBatch.length > 0) {
    embeddings.push(...(await embedValues(currentBatch, embeddingModelId)))
  }

  return embeddings
}

async function embedNormalTexts(
  texts: string[],
  existingEmbeddings: number[][],
  embeddingModelId: string,
) {
  const totalChars = texts.reduce((sum, t) => sum + t.length, 0)
  if (totalChars <= MAX_CHARS_PER_BATCH) {
    const embeddings = await embedValues(texts, embeddingModelId)
    return [...existingEmbeddings, ...embeddings]
  }

  const batchEmbeddings = await embedTextsInBatches(texts, embeddingModelId)
  return [...existingEmbeddings, ...batchEmbeddings]
}

/**
 * embed multiple text strings in batches, respecting token limits
 *
 * @param texts - Array of texts to embed
 * @param embeddingModelId - The model ID for embeddings (e.g., "openai/text-embedding-3-small")
 */
export async function embedTexts(
  texts: string[],
  embeddingModelId: string,
): Promise<number[][]> {
  if (texts.length === 0) return []

  const start = performance.now()
  const { normal, oversized } = partitionTexts(texts)
  const oversizedEmbeddings = await embedOversizedTexts(
    oversized,
    embeddingModelId,
  )
  const finalEmbeddings =
    normal.length === 0
      ? oversizedEmbeddings
      : await embedNormalTexts(normal, oversizedEmbeddings, embeddingModelId)

  const totalChars = texts.reduce((sum, t) => sum + t.length, 0)
  logEmbed(
    `batched embed (${texts.length} texts, ${totalChars} chars) → ${finalEmbeddings.length} vectors`,
    performance.now() - start,
  )
  return finalEmbeddings
}
