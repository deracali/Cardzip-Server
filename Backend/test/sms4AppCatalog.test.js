import test from 'node:test';
import assert from 'node:assert/strict';
import { createSms4AppPage } from '../utils/sms4AppCatalog.js';

const catalog = {
  success: true,
  data: [
    { name: 'allservices' },
    { name: 'miscapp' },
    { name: 'whatsapp' },
    { name: 'telegram' },
    { name: 'Google Voice' },
    { name: 'whatsapp' },
  ],
};

test('returns a prioritized page without the provider all-services entry', () => {
  const result = createSms4AppPage(catalog, { limit: 2, offset: 0 });

  assert.deepEqual(result.data.map((app) => app.name), ['whatsapp', 'telegram']);
  assert.deepEqual(result.pagination, { limit: 2, offset: 0, total: 4, hasMore: true });
  assert.equal(result.success, true);
});

test('searches the full catalog before paginating', () => {
  const result = createSms4AppPage(catalog, { search: 'google', limit: 50, offset: 0 });

  assert.deepEqual(result.data.map((app) => app.name), ['Google Voice']);
  assert.equal(result.pagination.hasMore, false);
});
