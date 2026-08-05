export class JournalSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalSetupError'
  }
}
