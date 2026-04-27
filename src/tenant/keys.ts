// Tenant key wrapper — operator-private write/read boundary.
//
// Architecture invariant (master doc §3.3 layer 2 + §4.2 #6): operator-private
// data is wrapped before durable storage and unwrapped on read, with keys the
// tenant controls. The vendor (Kerf, Anthropic, Groq, etc.) never sees
// plaintext at rest.
//
// V1 ships the INTERFACE only. The `createStubTenantKeyWrapper` returned by
// this module preserves plaintext; it is NOT cryptographically secure. Its
// purpose is to establish the boundary: every operator-private write goes
// through `wrap()`, every read goes through `unwrap()`, and the V2.0α swap
// (KMS-backed) becomes a single-file change instead of a callsite-by-callsite
// refactor.
//
// Properties guaranteed by the V1 stub:
//   - wrap(p, {tenantId: 'A'}) → unwrap(secret, {tenantId: 'A'}) === p
//   - unwrap(secret_for_A, {tenantId: 'B'}) throws TenantKeyError
//   - WrappedSecret instances are Object.frozen
//
// NOT guaranteed by V1 stub (provided by V2.0α KMS-backed wrapper):
//   - Confidentiality of plaintext at rest
//   - Resistance to direct inspection of the `ciphertext` field

import { TenantKeyError } from '../shared/errors.js';

export type TenantId = string;

export interface TenantKeyContext {
  readonly tenantId: TenantId;
}

/**
 * Opaque wrapped secret. Treat as a black box — the only sanctioned way to
 * recover plaintext is via `TenantKeyWrapper.unwrap(secret, ctx)`. Reading the
 * `ciphertext` field directly is undefined behavior; the V1 stub leaves
 * plaintext accessible there for development only, and the V2.0α swap will
 * not.
 */
export interface WrappedSecret {
  readonly _wrapped: true;
  readonly tenantId: TenantId;
  readonly version: 'v1-stub';
  readonly ciphertext: string;
}

export interface TenantKeyWrapper {
  /**
   * Wrap plaintext for storage. The returned `WrappedSecret` is opaque —
   * consumers must round-trip through `unwrap` to recover plaintext.
   */
  wrap(plaintext: string, ctx: TenantKeyContext): Promise<WrappedSecret>;

  /**
   * Unwrap a previously-wrapped secret. Throws `TenantKeyError` when
   * `ctx.tenantId` does not match the secret's `tenantId` (the canonical
   * cross-tenant safety property).
   */
  unwrap(secret: WrappedSecret, ctx: TenantKeyContext): Promise<string>;
}

/**
 * Type guard for `WrappedSecret`. Use to narrow `unknown` values returned
 * from storage layers before passing to `unwrap`.
 */
export function isWrappedSecret(value: unknown): value is WrappedSecret {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { _wrapped?: unknown; tenantId?: unknown; version?: unknown; ciphertext?: unknown };
  return (
    candidate._wrapped === true &&
    typeof candidate.tenantId === 'string' &&
    candidate.version === 'v1-stub' &&
    typeof candidate.ciphertext === 'string'
  );
}

/**
 * V1 stub wrapper. Establishes the boundary; replaced in V2.0α with a
 * KMS-backed implementation. See module-level comment for the security
 * caveats.
 */
export function createStubTenantKeyWrapper(): TenantKeyWrapper {
  return {
    async wrap(plaintext, ctx) {
      return Object.freeze({
        _wrapped: true as const,
        tenantId: ctx.tenantId,
        version: 'v1-stub' as const,
        ciphertext: plaintext,
      });
    },
    async unwrap(secret, ctx) {
      if (secret.tenantId !== ctx.tenantId) {
        throw new TenantKeyError(
          `Cross-tenant unwrap blocked: secret tenantId='${secret.tenantId}' does not match context tenantId='${ctx.tenantId}'`,
        );
      }
      return secret.ciphertext;
    },
  };
}
