// Structured error hierarchy. Every throw in Kerf extends KerfError so callers
// can rely on `err instanceof KerfError` and read a stable `code`.

export class KerfError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'KerfError';
    this.code = code;
    this.cause = cause;
  }
}

export class PermissionError extends KerfError {
  constructor(message: string, cause?: unknown) {
    super('PERMISSION_DENIED', message, cause);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends KerfError {
  constructor(message: string, cause?: unknown) {
    super('VALIDATION_FAILED', message, cause);
    this.name = 'ValidationError';
  }
}

export class ContractError extends KerfError {
  constructor(message: string, cause?: unknown) {
    super('CONTRACT_VIOLATION', message, cause);
    this.name = 'ContractError';
  }
}

export class MoneyError extends KerfError {
  constructor(message: string, cause?: unknown) {
    super('MONEY_INVARIANT', message, cause);
    this.name = 'MoneyError';
  }
}

export class TenantKeyError extends KerfError {
  constructor(message: string, cause?: unknown) {
    super('TENANT_KEY_VIOLATION', message, cause);
    this.name = 'TenantKeyError';
  }
}
