const test = require('node:test');
const assert = require('node:assert/strict');
const { ecosystemPath } = require('../src/services/pm2.service');

test('ecosystem path is always cjs', () => {
  const target = ecosystemPath('/srv/app');
  assert.equal(target, '/srv/app/ecosystem.config.cjs');
  assert.equal(target.endsWith('.js'), false);
});
