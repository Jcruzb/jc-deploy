const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { resolveApp } = require('../services/app.service');
const { inspectProject, printProjectState } = require('../services/state.service');
const { updateProject } = require('../services/deploy-ops.service');
const { ensureSudo, keepAlive, stopKeepAlive } = require('../services/sudo.service');
const { offerImportIfMissingMetadata } = require('../services/import-prompt.service');

async function runUpdate(appName, { dryRun = false } = {}) {
  const runner = new Runner({ dryRun });
  const app = await resolveApp(appName);
  const imported = await offerImportIfMissingMetadata(runner, app, { dryRun });
  if (imported) app.config = imported;
  const config = app.config || { appName: app.appName, projectPath: app.projectPath };
  logger.title(`Update: ${config.appName || app.appName}`);
  const state = await inspectProject(runner, { ...config, projectPath: app.projectPath });
  printProjectState(state);
  if (config.nginxEnabled || config.sslEnabled || config.publicDir) {
    await ensureSudo(runner);
    keepAlive(runner);
  }
  await updateProject(runner, { ...config, projectPath: app.projectPath }, state);
  stopKeepAlive();
  logger.success('Update completado.');
}

module.exports = {
  runUpdate
};
