import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStubTenantKeyWrapper,
  isWrappedSecret,
  TenantKeyError,
  type TenantKeyContext,
  type WrappedSecret,
} from '../src/tenant/index.js';

const ctxA: TenantKeyContext = { tenantId: 'tenant-A' };
const ctxB: TenantKeyContext = { tenantId: 'tenant-B' };

test('wrap then unwrap with the same tenant context returns plaintext', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const plaintext = 'operator-private memory note';

  const secret = await wrapper.wrap(plaintext, ctxA);
  const recovered = await wrapper.unwrap(secret, ctxA);

  assert.equal(recovered, plaintext);
});

test('wrap returns a frozen WrappedSecret with the discriminator marker', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const secret = await wrapper.wrap('payload', ctxA);

  assert.equal(secret._wrapped, true);
  assert.equal(secret.tenantId, ctxA.tenantId);
  assert.equal(secret.version, 'v1-stub');
  assert.equal(Object.isFrozen(secret), true);
});

test('cross-tenant unwrap throws TenantKeyError without leaking plaintext', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const secret = await wrapper.wrap('confidential', ctxA);

  await assert.rejects(
    () => wrapper.unwrap(secret, ctxB),
    (err: unknown) => {
      assert.ok(err instanceof TenantKeyError);
      assert.equal(err.code, 'TENANT_KEY_VIOLATION');
      assert.match(err.message, /tenant-A/);
      assert.match(err.message, /tenant-B/);
      // The error message must not contain the plaintext.
      assert.equal(err.message.includes('confidential'), false);
      return true;
    },
  );
});

test('empty plaintext round-trips correctly', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const secret = await wrapper.wrap('', ctxA);
  const recovered = await wrapper.unwrap(secret, ctxA);

  assert.equal(recovered, '');
});

test('multi-line and unicode plaintext round-trips correctly', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const plaintext = 'línea 1\nlínea 2\n— Mano Derecha says hola 👋';

  const secret = await wrapper.wrap(plaintext, ctxA);
  const recovered = await wrapper.unwrap(secret, ctxA);

  assert.equal(recovered, plaintext);
});

test('isWrappedSecret narrows valid WrappedSecret-shaped values', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const secret = await wrapper.wrap('x', ctxA);

  assert.equal(isWrappedSecret(secret), true);

  // Plain string, plain object, null, undefined, and look-alike shapes
  // must NOT pass the guard.
  assert.equal(isWrappedSecret(null), false);
  assert.equal(isWrappedSecret(undefined), false);
  assert.equal(isWrappedSecret('plaintext'), false);
  assert.equal(isWrappedSecret({}), false);
  assert.equal(
    isWrappedSecret({ tenantId: 'tenant-A', ciphertext: 'x', version: 'v1-stub' }),
    false,
    '_wrapped marker required',
  );
  assert.equal(
    isWrappedSecret({ _wrapped: true, tenantId: 'tenant-A', ciphertext: 'x', version: 'v2' }),
    false,
    'version must match the V1 stub',
  );
});

test('two wraps of the same plaintext are deep-equal under the V1 stub (no nonce)', async () => {
  // V2.0α with KMS will likely add a nonce, breaking this property. The test
  // pins V1 stub behavior so the V2.0α swap deliberately surfaces the change.
  const wrapper = createStubTenantKeyWrapper();
  const a = await wrapper.wrap('payload', ctxA);
  const b = await wrapper.wrap('payload', ctxA);

  assert.deepEqual(a, b);
});

test('TenantKeyError extends KerfError and carries a stable code', async () => {
  const wrapper = createStubTenantKeyWrapper();
  const secret = await wrapper.wrap('x', ctxA);

  try {
    await wrapper.unwrap(secret, ctxB);
    assert.fail('expected TenantKeyError');
  } catch (err) {
    assert.ok(err instanceof TenantKeyError);
    assert.equal((err as TenantKeyError).code, 'TENANT_KEY_VIOLATION');
    assert.equal((err as TenantKeyError).name, 'TenantKeyError');
  }

  // Type-only check: WrappedSecret type-export round-trips
  const _typeCheck: WrappedSecret = secret;
  assert.equal(_typeCheck._wrapped, true);
});
