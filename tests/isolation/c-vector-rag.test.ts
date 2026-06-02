import assert from 'node:assert/strict';

import {
  InMemoryPerTenantVectorStore,
  retrieveVectors,
  type VectorDocument,
} from '../../src/isolation/vectorRetrievalContract.js';
import { isolation, ISOLATION_CONTROL_TENANT } from './_harness.js';

const OTHER_DOC: VectorDocument = {
  id: 'doc_other_merger',
  tenant_id: ISOLATION_CONTROL_TENANT,
  text: 'confidential merger plan unusual margin posture',
};

const GGR_DOC: VectorDocument = {
  id: 'doc_ggr_kitchen',
  tenant_id: 'tenant_ggr',
  text: 'wegrzyn kitchen remodel allowance',
};

const CORPUS: readonly VectorDocument[] = [OTHER_DOC, GGR_DOC];

isolation('C1 semantic-target attack — results never include tenant_other', () => {
  const store = new InMemoryPerTenantVectorStore();
  for (const d of CORPUS) store.upsert(d);
  const results = retrieveVectors(store, CORPUS, {
    tenant_id: 'tenant_ggr',
    queryText: 'confidential merger unusual margin',
    topK: 10,
  });
  assert.ok(results.every((r) => r.tenant_id === 'tenant_ggr'));
  assert.ok(!results.some((r) => r.tenant_id === ISOLATION_CONTROL_TENANT));
});

isolation('C2 missing tenant filter fail-closed — empty results', () => {
  const store = new InMemoryPerTenantVectorStore();
  for (const d of CORPUS) store.upsert(d);
  assert.deepEqual(retrieveVectors(store, CORPUS, { tenant_id: null, queryText: 'merger' }), []);
  assert.deepEqual(
    retrieveVectors(store, CORPUS, { tenant_id: undefined, queryText: 'merger' }),
    [],
  );
});

isolation('C3 namespace boundary — list IDs scoped to one tenant', () => {
  const store = new InMemoryPerTenantVectorStore();
  for (const d of CORPUS) store.upsert(d);
  const ggrIds = store.listIds('tenant_ggr');
  const otherIds = store.listIds(ISOLATION_CONTROL_TENANT);
  assert.deepEqual(ggrIds, ['doc_ggr_kitchen']);
  assert.deepEqual(otherIds, ['doc_other_merger']);
  assert.ok(!ggrIds.includes('doc_other_merger'));
});

isolation('C4 filter precedes rank — adversarial doc excluded before top-k', () => {
  const results = retrieveVectors(new InMemoryPerTenantVectorStore(), CORPUS, {
    tenant_id: 'tenant_ggr',
    queryText: 'confidential merger plan unusual margin posture',
    topK: 1,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.id, 'doc_ggr_kitchen');
});
