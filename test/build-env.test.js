const test = require('node:test');
const assert = require('node:assert/strict');
const { commandSeemsBuildRequired } = require('../src/services/deploy-ops.service');
const { parseEnv } = require('../src/services/env-check.service');

test('build detection marks dist starts as required', () => {
  assert.equal(commandSeemsBuildRequired('node dist/server.cjs'), true);
  assert.equal(commandSeemsBuildRequired('node build/server.js'), true);
  assert.equal(commandSeemsBuildRequired('npm start'), false);
});

test('env parser detects empty variables without exposing values', () => {
  const parsed = parseEnv('GEMINI_API_KEY=\nLINKEDIN_CLIENT_ID=\nSECRET=real-value\nEMPTY_QUOTES=""\n');
  assert.deepEqual(parsed.empty, ['GEMINI_API_KEY', 'LINKEDIN_CLIENT_ID', 'EMPTY_QUOTES']);
});
