/** Every key/model slot is exhausted, dead or cooling for longer than the configured maximum wait. */
export class LlmExhaustedError extends Error {
  constructor(
    message: string,
    readonly slots: string[] = [],
  ) {
    super(message);
    this.name = "LlmExhaustedError";
  }
}

/** The prompt cannot be shrunk below the smallest model limit available. */
export class PromptTooLargeError extends Error {
  constructor(
    message: string,
    readonly estimatedTokens: number,
    readonly limitTokens: number,
  ) {
    super(message);
    this.name = "PromptTooLargeError";
  }
}
