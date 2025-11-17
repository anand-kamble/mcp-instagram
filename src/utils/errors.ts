/**
 * Error handling utilities
 */

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function handleError(error: unknown): { message: string; details?: any } {
  if (error instanceof ToolError) {
    return {
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      details: { stack: error.stack },
    };
  }

  return {
    message: "Unknown error occurred",
    details: error,
  };
}

