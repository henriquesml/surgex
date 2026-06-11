// Expected user-facing errors (bad flags, missing index, not a git repo).
// The CLI prints these as a one-line message instead of a stack trace.
export class UsageError extends Error {}
