const { Runner } = require('../core/runner');
const { runImportFlow } = require('../services/import.service');

async function runImport({ dryRun = false } = {}) {
  const runner = new Runner({ dryRun });
  await runImportFlow(runner, { dryRun });
}

module.exports = {
  runImport
};
