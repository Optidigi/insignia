/**
 * Error Handling Utilities
 * 
 * Provides consistent error responses across all API endpoints.
 * Follows the pattern: { error: { code, message, details? } }
 */

import { data } from "react-router";
import { v4 as uuid } from "uuid";

/**
 * Standard error codes used across the application
 */
export const ErrorCodes = {
  // Client errors (4xx)
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CONFIG: "INVALID_CONFIG",
  
  // Server errors (5xx)
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Application error class with structured error info
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  const requestId = uuid();
  
  // Log the error server-side
  console.error(`[Error] ${requestId} - ${code}: ${message}`, details);
  
  return data(
    {
      error: {
        code,
        message,
        requestId,
        ...(details && { details }),
      },
    },
    { status }
  );
}

/**
 * Convenience functions for common error types
 */
export const Errors = {
  badRequest(message: string, details?: Record<string, unknown>) {
    return errorResponse(ErrorCodes.BAD_REQUEST, message, 400, details);
  },

  unauthorized(message: string = "Authentication required") {
    return errorResponse(ErrorCodes.UNAUTHORIZED, message, 401);
  },

  forbidden(message: string = "Access denied") {
    return errorResponse(ErrorCodes.FORBIDDEN, message, 403);
  },

  notFound(resource: string = "Resource") {
    return errorResponse(ErrorCodes.NOT_FOUND, `${resource} not found`, 404);
  },

  conflict(message: string, details?: Record<string, unknown>) {
    return errorResponse(ErrorCodes.CONFLICT, message, 409, details);
  },

  validationError(message: string, details?: Record<string, unknown>) {
    return errorResponse(ErrorCodes.VALIDATION_ERROR, message, 422, details);
  },

  internal(message: string = "An unexpected error occurred") {
    return errorResponse(ErrorCodes.INTERNAL_ERROR, message, 500);
  },
};

/**
 * Handle errors thrown in route handlers
 */
export function handleError(error: unknown) {
  if (error instanceof AppError) {
    return errorResponse(error.code, error.message, error.status, error.details);
  }

  if (error instanceof Response) {
    // Already a response, return as-is
    return error;
  }

  // Log unexpected errors
  console.error("[Unhandled Error]", error);

  return Errors.internal();
}

/**
 * Validation helper for Zod schemas
 */
export function validateOrThrow<T>(
  schema: { parse: (data: unknown) => T },
  data: unknown,
  errorMessage: string = "Validation failed"
): T {
  try {
    return schema.parse(data);
  } catch (error: unknown) {
    const err = error as { errors?: unknown; message?: string };
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      errorMessage,
      422,
      { errors: err.errors ?? err.message }
    );
  }
}
