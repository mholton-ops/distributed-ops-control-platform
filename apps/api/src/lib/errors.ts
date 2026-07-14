export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly code = "API_ERROR"
  ) {
    super(message);
    this.name = "ApiError";
  }
}
