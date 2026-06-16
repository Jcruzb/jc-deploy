const test = require('node:test');
const assert = require('node:assert/strict');
const { Runner } = require('../src/core/runner');

test('dry-run runner returns without executing commands', async () => {
  const runner = new Runner({ dryRun: true });
  const result = await runner.run('definitely-not-a-real-command', [], { spinner: false });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '');
});
