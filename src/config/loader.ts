import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import {
  DEFAULT_AGENTS,
  DEFAULT_MODELS,
  DEFAULT_QDRANT_URL,
  DEFAULT_SERVER_PORT,
  makeCollectionNames,
  sanitizeSlug,
} from "./defaults"
import {
  type DocbotUserConfig,
  docbotConfigSchema,
  type ResolvedConfig,
} from "./schema"

const CONFIG_FILENAMES = [
  "docbot.config.ts",
  "docbot.config.js",
  "docbot.config.json",
  "docbot.config.jsonc",
]

/**
 * find the config file by searching up from the given directory
 */
function findConfigFile(startDir: string): string | null {
  let current = resolve(startDir)
  const root = dirname(current)

  while (current !== root) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(current, filename)
      if (existsSync(candidate)) {
        return candidate
      }
    }
    current = dirname(current)
  }

  return null
}

/**
 * find package.json and extract project name
 */
async function findProjectName(startDir: string): Promise<string | null> {
  let current = resolve(startDir)
  const root = dirname(current)

  while (current !== root) {
    const pkgPath = join(current, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const content = await readFile(pkgPath, "utf-8")
        const pkg = JSON.parse(content)
        return pkg.name ?? null
      } catch {
        return null
      }
    }
    current = dirname(current)
  }

  return null
}

/**
 * find the project root (directory containing package.json)
 */
export function findProjectRoot(startDir: string): string | null {
  let current = resolve(startDir)
  const root = dirname(current)

  while (current !== root) {
    const pkgPath = join(current, "package.json")
    if (existsSync(pkgPath)) {
      return current
    }
    current = dirname(current)
  }

  return null
}

/**
 * load and parse a config file
 */
async function loadConfigFile(path: string): Promise<DocbotUserConfig | null> {
  try {
    if (path.endsWith(".ts") || path.endsWith(".js")) {
      // use bun's import for ts/js files
      const mod = await import(path)
      return mod.default ?? mod
    }

    if (path.endsWith(".jsonc")) {
      // use bun's native jsonc loader which handles comments and trailing commas
      const mod = await import(path, { with: { type: "jsonc" } })
      return mod.default
    }

    // plain json
    const content = await readFile(path, "utf-8")
    return JSON.parse(content)
  } catch (error) {
    console.warn(`failed to load config from ${path}:`, error)
    return null
  }
}

export interface LoadConfigOptions {
  // starting directory for config search
  startDir: string
  // explicit config file path (overrides search)
  configPath?: string
  // cli overrides
  overrides?: Partial<{
    qdrantUrl: string
    port: number
    docs: string
    codebase: string | string[]
  }>
}

function normalizeCodebase(value?: string | string[]): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value.filter(Boolean)
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
}

function readEnv() {
  return {
    codebase: process.env.DOCBOT_CODEBASE,
    docs: process.env.DOCBOT_DOCS,
    manifest: process.env.DOCBOT_MANIFEST_PATH,
    port: process.env.DOCBOT_PORT,
    qdrantUrl: process.env.QDRANT_URL,
  }
}

async function loadUserConfigFromFile(
  configPath: string | undefined,
  startDir: string,
): Promise<DocbotUserConfig> {
  const configFile = configPath ?? findConfigFile(startDir)
  if (!configFile) return {}

  const loaded = await loadConfigFile(configFile)
  if (!loaded) return {}

  const parsed = docbotConfigSchema.safeParse(loaded)
  if (parsed.success) {
    return parsed.data
  }

  console.warn("invalid config file:", parsed.error.format())
  return {}
}

async function resolveProjectInfo(startDir: string) {
  const projectRoot = findProjectRoot(startDir)
  const projectName = await findProjectName(startDir)
  return {
    defaultSlug: projectName ? sanitizeSlug(projectName) : "docbot",
    projectRoot,
  }
}

function resolvePaths(
  baseDir: string,
  userConfig: DocbotUserConfig,
  env: ReturnType<typeof readEnv>,
  overrides?: LoadConfigOptions["overrides"],
) {
  const cacheDir = join(baseDir, ".docbot")
  const manifestPath =
    env.manifest ??
    userConfig.qdrant?.manifestPath ??
    join(cacheDir, "manifest.json")
  const docsPath =
    overrides?.docs ?? env.docs ?? userConfig.paths?.docs ?? undefined
  const codebasePaths = normalizeCodebase(
    overrides?.codebase ?? env.codebase ?? userConfig.paths?.codebase,
  )

  return {
    cacheDir,
    codebase: codebasePaths?.map((p) => resolve(baseDir, p)),
    docs: docsPath ? resolve(baseDir, docsPath) : undefined,
    manifest: manifestPath,
  }
}

function resolveAgentsConfig(userConfig: DocbotUserConfig) {
  return {
    discoveryBudget:
      userConfig.agents?.discoveryBudget ?? DEFAULT_AGENTS.discoveryBudget,
  }
}

function resolveModelConfig(userConfig: DocbotUserConfig) {
  return {
    context: userConfig.models?.context ?? DEFAULT_MODELS.context,
    embedding: userConfig.models?.embedding ?? DEFAULT_MODELS.embedding,
    embeddingLarge:
      userConfig.models?.embeddingLarge ?? DEFAULT_MODELS.embeddingLarge,
    fast: userConfig.models?.fast ?? DEFAULT_MODELS.fast,
    nano: userConfig.models?.nano ?? DEFAULT_MODELS.nano,
    planning: userConfig.models?.planning ?? DEFAULT_MODELS.planning,
    planningHeavy:
      userConfig.models?.planningHeavy ?? DEFAULT_MODELS.planningHeavy,
    prose: userConfig.models?.prose ?? DEFAULT_MODELS.prose,
  }
}

function resolveQdrantConfig(
  userConfig: DocbotUserConfig,
  slug: string,
  env: ReturnType<typeof readEnv>,
  overrides: LoadConfigOptions["overrides"],
  manifestPath: string,
) {
  return {
    collections: userConfig.qdrant?.collections ?? makeCollectionNames(slug),
    manifestPath,
    url:
      overrides?.qdrantUrl ??
      userConfig.qdrant?.url ??
      env.qdrantUrl ??
      DEFAULT_QDRANT_URL,
  }
}

function resolveServerConfig(
  userConfig: DocbotUserConfig,
  env: ReturnType<typeof readEnv>,
  overrides: LoadConfigOptions["overrides"],
) {
  return {
    port:
      overrides?.port ??
      userConfig.server?.port ??
      (env.port ? Number(env.port) : undefined) ??
      DEFAULT_SERVER_PORT,
  }
}

/**
 * load and resolve the full configuration
 *
 * priority: cli args > config file > defaults
 */
export async function loadConfig(
  options: LoadConfigOptions,
): Promise<ResolvedConfig> {
  const { startDir, configPath, overrides } = options

  const env = readEnv()
  const { defaultSlug, projectRoot } = await resolveProjectInfo(startDir)
  const userConfig = await loadUserConfigFromFile(configPath, startDir)
  const slug = userConfig.projectSlug ?? defaultSlug
  const baseDir = projectRoot ?? startDir
  const paths = resolvePaths(baseDir, userConfig, env, overrides)

  return {
    agents: resolveAgentsConfig(userConfig),
    models: resolveModelConfig(userConfig),
    paths,
    projectSlug: slug,
    qdrant: resolveQdrantConfig(
      userConfig,
      slug,
      env,
      overrides,
      paths.manifest,
    ),
    server: resolveServerConfig(userConfig, env, overrides),
  }
}
