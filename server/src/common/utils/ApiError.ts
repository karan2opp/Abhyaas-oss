export class ApiError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    // A short machine-readable reason (for example "AI_KEY_REQUIRED") the website can act on, besides the readable message.
    public readonly code: string | undefined;

    constructor(statusCode: number, message: string, code?: string) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true; // Indicates it's a known, handled error
        Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad Request") {
        return new ApiError(400, message);
    }

    static unauthorized(message = "Unauthorized") {
        return new ApiError(401, message);
    }

    static forbidden(message = "Forbidden") {
        return new ApiError(403, message);
    }

    static notFound(message = "Not Found") {
        return new ApiError(404, message);
    }

    static conflict(message = "Conflict") {
        return new ApiError(409, message);
    }
    
    static internal(message = "Internal Server Error") {
        return new ApiError(500, message);
    }
}
