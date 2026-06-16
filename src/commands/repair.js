const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { resolveApp } = require('../services/app.service');
const { inspectProject, printProjectState } = require('../services/state.service');
const { repairBackProject } = require('../services/deploy-ops.service');
const { ensureSudo, keepAlive, stopKeepAlive } = require('../services/sudo.service');
const { offerImportIfMissingMetadata } = require('../services/import-prompt.service');

async function runRepair(appName, { dryRun = false } = {}) {
  const runner = new Runner({ dryRun });
  const app = await resolveApp(appName);
  const imported = await offerImportIfMissingMetadata(runner, app, { dryRun });
  if (imported) app.config = imported;
  const config = app.config || { appName: app.appName, projectPath: app.projectPath, type: 'back' };
  logger.title(`Repair: ${config.appName || app.appName}`);
  const state = await inspectProject(runner, { ...config, projectPath: app.projectPath });
  printProjectState(state);
  if (config.type && config.type !== 'back') {
    logger.warn('La reparacion automatica completa esta implementada para backend. Se aplicaran solo pasos compatibles.');
  }
  if (config.nginxEnabled || config.sslEnabled || config.domain) {
    await ensureSudo(runner);
    keepAlive(runner);
  }
  await repairBackProject(runner, { ...config, projectPath: app.projectPath }, state);
  stopKeepAlive();
  logger.success('Repair completado.');
}

module.exports = {
  runRepair
};
