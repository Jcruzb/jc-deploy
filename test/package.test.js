const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPackageManagerFromFiles, installCommandFor } = require('../src/services/package.service');

test('package manager detection maps lockfiles to install commands', () => {
  assert.equal(installCommandFor(detectPackageManagerFromFiles({})), 'npm install');
  assert.equal(installCommandFor(detectPackageManagerFromFiles({ packageLock: true })), 'npm ci');
  assert.equal(installCommandFor(detectPackageManagerFromFiles({ yarnLock: true })), 'yarn install');
  assert.equal(installCommandFor(detectPackageManagerFromFiles({ pnpmLock: true })), 'pnpm install');
});
