/** A rejected save includes the server's current total for explicit reconfirmation. */
export class ActivityTimeConflictError extends Error {
  readonly previousSeconds: number;

  constructor(message: string, previousSeconds: number) {
    super(message);
    this.name = 'ActivityTimeConflictError';
    this.previousSeconds = previousSeconds;
  }
}
