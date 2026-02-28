export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ApiError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly url: string,
    cause?: unknown,
  ) {
    super(message, 'API_ERROR', cause);
    this.name = 'ApiError';
  }
}

export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause);
    this.name = 'ConfigError';
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_ERROR', cause);
    this.name = 'StorageError';
  }
}
