const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeConfig, indexEntryFromConfig } = require('../src/services/deploy-config.service');
const { inferType, parseNginxConfig } = require('../src/services/import.service');
const { parseEnv } = require('../src/services/env-check.service');

test('metadata helpers omit obvious secret fields and keep env state only', () => {
  const clean = sanitizeConfig({
    appName: 'meta-app',
    type: 'back',
    projectPath: '/home/user/apps/meta-app',
    apiKey: 'must-not-store',
    token: 'must-not-store',
    status: 'partial'
  });
  const env = parseEnv('GEMINI_API_KEY=\nSECRET_VALUE=real\n');
  assert.equal(clean.apiKey, undefined);
  assert.equal(clean.token, undefined);
  assert.deepEqual(env.empty, ['GEMINI_API_KEY']);
});

test('sanitizeConfig strips top-level secret-like fields', () => {
  const clean = sanitizeConfig({ appName: 'x', password: 'secret', normal: 'ok' });
  assert.deepEqual(clean, { appName: 'x', normal: 'ok' });
});

test('infer type handles basic front/back/fullstack cases', () => {
  assert.equal(inferType('/tmp/nope', { scripts: {} }, { hasFrontendDir: true, hasBackendDir: true }), 'fullstack');
  assert.equal(inferType('/tmp/nope', { scripts: { build: 'vite build' } }), 'front');
  assert.equal(inferType('/tmp/nope', { scripts: { start: 'node dist/server.cjs' } }), 'back');
});

test('global index entries are compact and keyed by metadata path', () => {
  const entry = indexEntryFromConfig({
    appName: 'cv_proexpress',
    type: 'back',
    projectPath: '/home/juan/apps/cv_proexpress',
    domain: 'cvstudio.example.com',
    pm2Name: 'cv_proexpress',
    status: 'partial',
    updatedAt: '2026-06-16T00:00:00.000Z'
  });
  assert.equal(entry.metadataPath, '/home/juan/apps/cv_proexpress/.jc-deploy.json');
  assert.equal(entry.appName, 'cv_proexpress');
});

test('parse nginx config infers domain root and proxy port', () => {
  const parsed = parseNginxConfig('server_name app.example.com; root /var/www/app; proxy_pass http://127.0.0.1:3000;', '/etc/nginx/sites-available/app');
  assert.equal(parsed.domain, 'app.example.com');
  assert.equal(parsed.root, '/var/www/app');
  assert.equal(parsed.proxyPort, 3000);
});
