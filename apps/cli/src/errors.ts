export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export class CliCanceledError extends CliError {
  constructor() {
    super('操作已取消', 0)
    this.name = 'CliCanceledError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误'
}
