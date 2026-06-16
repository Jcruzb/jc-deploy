const test = require('node:test');
const assert = require('node:assert/strict');
const { canRestartWithPm2, restartMetadataPatch } = require('../src/services/restart.service');

test('restart requires pm2Name metadata', () => {
  assert.equal(canRestartWithPm2({ pm2Name: 'app' }), true);
  assert.equal(canRestartWithPm2({}), false);
  assert.equal(canRestartWithPm2(null), false);
});

test('restart metadata patch includes restart timestamp and status', () => {
  const patch = restartMetadataPatch('restarted');
  assert.equal(patch.status, 'restarted');
  assert.match(patch.lastRestartAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(patch.updatedAt, patch.lastRestartAt);
});
