const inquirer = require('inquirer');
const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { validateDomain, validatePort } = require('../core/validators');
const { askCommonRepoInfo, askEnvCreation, askNginxAndSsl, confirmFinalSummary } = require('../core/prompts');
const { cloneForAnalysis, ensureProjectRepo } = require('../services/git.service');
const { analyzeNodeProject, splitCommand } = require('../services/package.service');
const { hasEnvExample } = require('../services/filesystem.service');
const { createEnvFromExample } = require('../services/env.service');
const { showListeningPorts, suggestFreePort } = require('../services/ports.service');
const { ensureCommands, ensurePm2, ensureCertbotIfNeeded } = require('../services/preflight.service');
const { ensureEcosystemConfig, startOrRestart, showLogs } = require('../services/pm2.service');
const { installSite, testAndReload } = require('../services/nginx.service');
const { runCertbot } = require('../services/certbot.service');
const { nginxBackTemplate } = require('../templates/nginx.back.template');

async function runBackDeploy({ dryRun = false } = {}) {
  const deployRunner = new Runner({ dryRun });
  const analysisRunner = new Runner({ dryRun: false });
  logger.title('Deploy backend');

  const common = await askCommonRepoInfo();
  await ensureCommands(analysisRunner, ['git', 'node', 'npm']);
  const analysisDir = await cloneForAnalysis(analysisRunner, common.repoUrl, common.appName);
  const analysis = await analyzeNodeProject(analysisDir);
  logger.info(`Scripts detectados: ${analysis.scriptNames.length ? analysis.scriptNames.join(', ') : 'ninguno'}`);

  const listening = await showListeningPorts(analysisRunner);
  const envExample = await hasEnvExample(analysisDir);
  const answers = await inquirer.prompt([
    { type: 'input', name: 'domain', message: 'Dominio o subdominio:', validate: validateDomain },
    {
      type: 'input',
      name: 'port',
      message: 'Puerto interno del backend:',
      default: suggestFreePort(listening),
      validate: validatePort,
      filter: Number
    },
    { type: 'input', name: 'installCommand', message: 'Comando de instalacion:', default: analysis.installCommand },
    { type: 'input', name: 'startCommand', message: 'Comando de start:', default: analysis.startCommand || 'npm start' },
    { type: 'input', name: 'pm2Name', message: 'Nombre PM2:', default: common.appName }
  ]);
  const createEnv = await askEnvCreation(envExample, '.env');
  const nginxSsl = await askNginxAndSsl(true);

  const config = { ...common, ...answers, ...nginxSsl, createEnv };
  const confirmed = await confirmFinalSummary('Resumen backend', {
    Repo: config.repoUrl,
    App: config.appName,
    Proyecto: config.projectDir,
    Dominio: config.domain,
    Puerto: config.port,
    Instalar: config.installCommand,
    Start: config.startCommand,
    PM2: config.pm2Name,
    Nginx: config.configureNginx ? 'si' : 'no',
    SSL: config.enableSsl ? 'si' : 'no',
    DryRun: dryRun ? 'si' : 'no'
  });
  if (!confirmed) throw new Error('Despliegue cancelado por el usuario.');

  await ensureCommands(deployRunner, ['git', 'node', 'npm']);
  await ensurePm2(deployRunner);
  if (config.configureNginx) await ensureCommands(deployRunner, ['nginx', 'systemctl']);
  await ensureCertbotIfNeeded(deployRunner, config.enableSsl);

  await ensureProjectRepo(deployRunner, config.repoUrl, config.projectDir);
  await deployRunner.run(...commandTuple(config.installCommand), { cwd: config.projectDir, message: 'Instalando dependencias' });
  if (config.createEnv && !dryRun) await createEnvFromExample(config.projectDir, true, '.env');
  if (config.createEnv && dryRun) logger.warn('dry-run: creacion de .env omitida');
  if (!dryRun) {
    await ensureEcosystemConfig(config.projectDir, {
      appName: config.pm2Name,
      cwd: config.projectDir,
      startCommand: config.startCommand,
      port: config.port
    });
  } else {
    logger.warn('dry-run: creacion de ecosystem.config.js omitida');
  }
  await startOrRestart(deployRunner, config.projectDir, config.pm2Name);

  if (config.configureNginx) {
    await installSite(deployRunner, config.appName, nginxBackTemplate(config));
    await testAndReload(deployRunner);
  }
  if (config.enableSsl) await runCertbot(deployRunner, config.domain, false);
  await showLogs(deployRunner, config.pm2Name);

  logger.success('Deploy backend completado.');
}

function commandTuple(command) {
  const parts = splitCommand(command);
  if (!parts.length) throw new Error('Comando vacio.');
  return [parts[0], parts.slice(1)];
}

module.exports = {
  runBackDeploy
};
