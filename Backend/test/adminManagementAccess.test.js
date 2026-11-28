import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSuperadmin } from '../middleware/authenticateAdmin.js';

const createResponse = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('blocks admins and staff from superadmin-only account management', () => {
  for (const role of ['admin', 'staff']) {
    const response = createResponse();
    let nextCalled = false;

    requireSuperadmin({ admin: { role } }, response, () => { nextCalled = true; });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.success, false);
    assert.equal(nextCalled, false);
  }
});

test('allows a superadmin to manage administrator accounts', () => {
  const response = createResponse();
  let nextCalled = false;

  requireSuperadmin({ admin: { role: 'superadmin' } }, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, null);
});
