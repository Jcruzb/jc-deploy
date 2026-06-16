const test = require('node:test');
const assert = require('node:assert/strict');
const { commandSeemsBuildRequired, startDependsOnBuild, shouldOfferSslActivation } = require('../src/services/deploy-ops.service');
const { parseEnv } = require('../src/services/env-check.service');

test('build detection marks dist starts as required', () => {
  assert.equal(commandSeemsBuildRequired('node dist/server.cjs'), true);
  assert.equal(commandSeemsBuildRequired('node build/server.js'), true);
  assert.equal(commandSeemsBuildRequired('npm start'), false);
});

test('start script indirection detects dist dependency', () => {
  assert.equal(startDependsOnBuild('npm start', { start: 'node dist/server.cjs' }), true);
  assert.equal(startDependsOnBuild('npm run prod', { prod: 'node build/server.js' }), true);
  assert.equal(startDependsOnBuild('npm start', { start: 'node server.js' }), true);
  assert.equal(startDependsOnBuild('npm start', { start: 'node src/server.js' }), false);
});

test('env parser detects empty variables without exposing values', () => {
  const parsed = parseEnv('GEMINI_API_KEY=\nLINKEDIN_CLIENT_ID=\nSECRET=real-value\nEMPTY_QUOTES=""\n');
  assert.deepEqual(parsed.empty, ['GEMINI_API_KEY', 'LINKEDIN_CLIENT_ID', 'EMPTY_QUOTES']);
});

test('ssl repair is offered only for nginx http apps without ssl', () => {
  assert.equal(shouldOfferSslActivation(
    { domain: 'app.example.com', sslEnabled: false },
    { nginxConfig: true, nginxEnabled: true, ssl: 'no' }
  ), true);
  assert.equal(shouldOfferSslActivation(
    { domain: 'app.example.com', sslEnabled: true },
    { nginxConfig: true, nginxEnabled: true, ssl: 'no' }
  ), false);
  assert.equal(shouldOfferSslActivation(
    { domain: 'app.example.com', sslEnabled: false },
    { nginxConfig: false, nginxEnabled: true, ssl: 'no' }
  ), false);
});
