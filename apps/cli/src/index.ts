#!/usr/bin/env node
import { runCli } from './cli.js'
import { CliCanceledError, CliError, errorMessage } from './errors.js'
import { failure } from './ui.js'

try {
  await runCli(process.argv.slice(2))
} catch (error) {
  if (error instanceof CliCanceledError) process.exitCode = 0
  else {
    if (process.argv[2] === 'mcp' && process.argv[3] === 'stdio') {
      // stdio 的 stdout 只能承载 MCP 协议消息。
      console.error(errorMessage(error))
    } else failure(errorMessage(error))
    process.exitCode = error instanceof CliError ? error.exitCode : 1
  }
}
