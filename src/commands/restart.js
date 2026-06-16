const { Runner } = require('../core/runner');
const { resolveRegisteredApp } = require('../services/app.service');
const { offerImportIfMissingMetadata } = require('../services/import-prompt.service');
const { restartApp } = require('../services/restart.service');

async function runRestart(appName, { dryRun = false } = {}) {
  const runner = new Runner({ dryRun });
  const app = await resolveRegisteredApp(appName);
  const imported = await offerImportIfMissingMetadata(runner, app, { dryRun });
  if (imported) app.config = imported;
  await restartApp(runner, app, { dryRun });
}

module.exports = {
  runRestart
};
