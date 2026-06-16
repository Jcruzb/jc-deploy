const { Runner } = require('../core/runner');
const { resolveApp } = require('../services/app.service');
const { showLogs } = require('../services/pm2.service');
const { offerImportIfMissingMetadata } = require('../services/import-prompt.service');

async function runLogs(appName) {
  const runner = new Runner({ dryRun: false });
  const app = await resolveApp(appName);
  const imported = await offerImportIfMissingMetadata(runner, app);
  if (imported) app.config = imported;
  const pm2Name = app.config && app.config.pm2Name ? app.config.pm2Name : app.appName;
  await showLogs(runner, pm2Name);
}

module.exports = {
  runLogs
};
