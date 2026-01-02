import { existsSync } from "node:fs"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { $ } from "bun"
import type { CommandModule } from "yargs"
import { findProjectRoot, makeCollectionNames, sanitizeSlug } from "../config"

export interface InitArgs {
  force: boolean
  "skip-docker": boolean
}

// helper: check if docker is installed
async function isDockerInstalled(): Promise<boolean> {
  try {
    await $`docker --version`.quiet()
    return true
  } catch {
    return false
  }
}

// helper: check if qdrant container is running
async function isQdrantRunning(): Promise<boolean> {
  try {
    const output =
      await $`docker ps --filter name=qdrant --format '{{.Names}}'`.text()
    return output.trim().includes("qdrant")
  } catch {
    return false
  }
}

// helper: check if qdrant is accessible on port 6333
async function isQdrantAccessible(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:6333/health")
    return response.ok
  } catch {
    return false
  }
}

// helper: start qdrant container
async function startQdrantContainer(storagePath: string): Promise<void> {
  const containerName = "docbot-qdrant"

  // check if container exists (stopped)
  try {
    const output =
      await $`docker ps -a --filter name=${containerName} --format '{{.Names}}'`.text()
    if (output.trim() === containerName) {
      console.info("starting existing qdrant container...")
      await $`docker start ${containerName}`.quiet()
      return
    }
  } catch {
    // container doesn't exist, will create below
  }

  // create and start new container
  console.info("starting qdrant container...")
  await $`docker run -d --name ${containerName} -p 6333:6333 -v ${storagePath}:/qdrant/storage qdrant/qdrant`.quiet()
}

// helper: handle docker setup
async function setupDocker(qdrantStorageDir: string): Promise<void> {
  console.info("checking docker setup...")
  console.info("")

  // check if docker is installed
  const dockerInstalled = await isDockerInstalled()
  if (!dockerInstalled) {
    console.warn("warning: docker is not installed or not in PATH")
    console.info("")
    console.info("to use docbot, you need qdrant running.")
    console.info("install docker and run:")
    console.info("")
    console.info(
      `   docker run -d -p 6333:6333 -v ${resolve(qdrantStorageDir)}:/qdrant/storage qdrant/qdrant`,
    )
    console.info("")
    console.info("or use a remote qdrant instance in docbot.config.jsonc")
    console.info("")
    return
  }

  // check if qdrant is already running
  const isRunning = await isQdrantRunning()
  const isAccessible = await isQdrantAccessible()

  if (isAccessible) {
    console.info("✓ qdrant is running and accessible at http://127.0.0.1:6333")
    console.info("")
    return
  }

  if (isRunning) {
    await handleExistingContainer()
    return
  }

  // start new qdrant container
  await startNewContainer(qdrantStorageDir)
}

// helper: handle existing container
async function handleExistingContainer(): Promise<void> {
  console.info("✓ qdrant container is running")
  console.info("  waiting for it to become accessible...")
  await new Promise((res) => setTimeout(res, 2000))
  const nowAccessible = await isQdrantAccessible()
  if (nowAccessible) {
    console.info("✓ qdrant is now accessible")
  } else {
    console.warn("  warning: qdrant may still be starting up")
  }
  console.info("")
}

// helper: start new container
async function startNewContainer(qdrantStorageDir: string): Promise<void> {
  try {
    await startQdrantContainer(resolve(qdrantStorageDir))
    console.info("✓ qdrant container started")
    console.info("  waiting for qdrant to be ready...")
    await new Promise((res) => setTimeout(res, 3000))
    const accessible = await isQdrantAccessible()
    if (accessible) {
      console.info("✓ qdrant is ready at http://127.0.0.1:6333")
    } else {
      console.warn("  warning: qdrant may still be starting up")
      console.info("  you can check status with: docker logs docbot-qdrant")
    }
    console.info("")
  } catch (error) {
    console.error("error: failed to start qdrant container")
    console.error(error instanceof Error ? error.message : String(error))
    console.info("")
    console.info("you can try starting it manually:")
    console.info("")
    console.info(
      `   docker run -d --name docbot-qdrant -p 6333:6333 -v ${resolve(qdrantStorageDir)}:/qdrant/storage qdrant/qdrant`,
    )
    console.info("")
  }
}

export const initCommand: CommandModule<object, InitArgs> = {
  builder: {
    force: {
      alias: "f",
      default: false,
      describe: "overwrite existing configuration",
      type: "boolean",
    },
    "skip-docker": {
      default: false,
      describe: "skip docker setup instructions",
      type: "boolean",
    },
  },
  command: "init",
  describe: "initialize docbot in the current project",

  handler: async (args) => {
    const cwd = process.cwd()

    // find project root
    const projectRoot = findProjectRoot(cwd)
    if (!projectRoot) {
      console.error(
        "error: could not find package.json in current directory or any parent",
      )
      console.error("please run this command from within a project directory")
      process.exit(1)
    }

    console.info(`initializing docbot in ${projectRoot}`)

    // extract project name
    const pkgPath = join(projectRoot, "package.json")
    let projectName = "docbot"

    try {
      const pkgContent = await readFile(pkgPath, "utf-8")
      const pkg = JSON.parse(pkgContent)
      if (pkg.name) {
        projectName = pkg.name
      }
    } catch {
      console.warn(
        "warning: could not read package.json, using default project name",
      )
    }

    const slug = sanitizeSlug(projectName)
    const collections = makeCollectionNames(slug)

    // check for existing config
    const configPath = join(projectRoot, "docbot.config.jsonc")
    if (existsSync(configPath) && !args.force) {
      console.error("error: docbot.config.jsonc already exists")
      console.error("use --force to overwrite")
      process.exit(1)
    }

    // create .docbot directory
    const docbotDir = join(projectRoot, ".docbot")
    const qdrantStorageDir = join(docbotDir, "qdrant_storage")

    console.info("creating .docbot directory...")
    await mkdir(qdrantStorageDir, { recursive: true })

    // create config file
    console.info("creating docbot.config.jsonc...")
    const configContent = `{
  // docbot configuration
  // see: https://github.com/helmlabs/helm/tree/main/packages/docbot

  // project identifier used for qdrant collection naming
  "projectSlug": "${slug}",

  // qdrant vector database settings
  "qdrant": {
    "url": "http://127.0.0.1:6333",
    "collections": {
      "docs": "${collections.docs}",
      "code": "${collections.code}"
    }
  }

  // uncomment to customize models:
  // "models": {
  //   "planning": "openai/gpt-5.2",
  //   "prose": "anthropic/claude-sonnet-4.5",
  //   "fast": "anthropic/claude-haiku-4.5"
  // }

  // uncomment to customize server:
  // "server": {
  //   "port": 3070
  // }
}
`

    await writeFile(configPath, configContent)

    // update .gitignore
    const gitignorePath = join(projectRoot, ".gitignore")
    const gitignoreEntry = "\n# docbot cache\n.docbot/\n"

    if (existsSync(gitignorePath)) {
      const gitignoreContent = await readFile(gitignorePath, "utf-8")
      if (!gitignoreContent.includes(".docbot")) {
        console.info("adding .docbot/ to .gitignore...")
        await appendFile(gitignorePath, gitignoreEntry)
      }
    } else {
      console.info("creating .gitignore with .docbot/ entry...")
      await writeFile(gitignorePath, `${gitignoreEntry.trim()}\n`)
    }

    console.info("")
    console.info("docbot initialized successfully!")
    console.info("")

    // docker setup
    if (!args["skip-docker"]) {
      await setupDocker(qdrantStorageDir)
    }

    console.info("configuration saved to docbot.config.jsonc")
    console.info("cache directory created at .docbot/")
    console.info("")
    console.info("next: run docbot with your task:")
    console.info(
      '   bunx @helmlabs/docbot run "your task" --docs ./docs --codebase ./src',
    )
  },
}
