import { isolation } from './_harness.js';

isolation(
  'F1 crypto-shred on tenant delete',
  async () => {
    /* contract placeholder */
  },
  { pending: 'TODO: tenant DEK destroy + backup scope when crypto-shred ships (§5.F1)' },
);

isolation(
  'F2 vector deletion follows record deletion',
  async () => {},
  { pending: 'TODO: vector index purge hook when embeddings store lands (§5.F2)' },
);

isolation(
  'F3 telemetry purge within TTL on tenant delete',
  async () => {},
  { pending: 'TODO: log/trace purge pipeline (§5.F3)' },
);

isolation(
  'F4 learning-derived deletion destroys tenant_local_only adapter',
  async () => {},
  { pending: 'TODO: per-tenant adapter destroy path (§5.F4)' },
);
