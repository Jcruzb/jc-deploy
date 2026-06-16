const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { resolveApp } = require('../services/app.service');
const { inspectProject, printProjectState } = require('../services/state.service');
const { writeDeployConfig } = require('../services/deploy-config.service');
const { offerImportIfMissingMetadata } = require('../services/import-prompt.service');

async function runStatus(appName) {
  const runner = new Runner({ dryRun: false });
  const app = await resolveApp(appName);
  const imported = await offerImportIfMissingMetadata(runner, app);
  if (imported) app.config = imported;
  logger.title(`Estado: ${app.appName}`);
  const state = await inspectProject(runner, {
    appName: app.appName,
    projectPath: app.projectPath,
    ...(app.config || {})
  });
  printProjectState(state);
  if (app.config) {
    await writeDeployConfig(app.projectPath, {
      ...app.config,
      lastStatusCheckAt: new Date().toISOString()
    });
  }
}

module.exports = {
  runStatus
};
