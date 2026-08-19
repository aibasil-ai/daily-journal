export type JournalErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'CONFLICT'
  | 'DATA_ERROR'
  | 'INVALID_REQUEST'
  | 'LOCK_TIMEOUT'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SCHEMA_MISMATCH'

/** 可安全回傳給前端的預期錯誤。 */
export class JournalError extends Error {
  constructor(
    public readonly code: JournalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'JournalError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isJournalError(error: unknown): error is JournalError {
  return error instanceof JournalError
}
