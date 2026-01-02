#!/usr/bin/env bun

import yargs from "yargs"
import { hideBin } from "yargs/helpers"

import { indexCommand } from "./commands/index-docs"
import { initCommand } from "./commands/init"
import { runCommand } from "./commands/run"
import { searchCommand } from "./commands/search"
import { serveCommand } from "./commands/serve"

yargs(hideBin(process.argv))
  .scriptName("docbot")
  .command(initCommand)
  .command(runCommand)
  .command(serveCommand)
  .command(indexCommand)
  .command(searchCommand)
  .demandCommand(1, "you must specify a command")
  .strict()
  .help()
  .parse()
