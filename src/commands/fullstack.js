const path = require('path');
const inquirer = require('inquirer');
const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { validateDomain, validatePort, normalizeApiPath } = require('../core/validators');
const { askCommonRepoInfo, askEnvCreation, askNginxAndSsl, confirmFinalSummary } = require('../core/prompts');
const { cloneForAnalysis, ensureProjectRepo } = require('../services/git.service');
const { analyzeNodeProject, splitCommand } = require('../services/package.service');
const { hasEnvExample, ensureDirWithSudo, suggestExistingSubdir } = require('../services/filesystem.service');
const { createEnvFromExample } = require('../services/env.service');
const { showListeningPorts, suggestFreePort } = require('../services/ports.service');
const { ensureCommands, ensurePm2, ensureCertbotIfNeeded } = require('../services/preflight.service');
const { ensureEcosystemConfig, startOrRestart } = require('../services/pm2.service');
const { installSite, testAndReload } = require('../services/nginx.service');
const { runCertbot } = require('../services/certbot.service');
const { nginxFullstackTemplate } = require('../templates/nginx.fullstack.template');
const { writeDeployConfig } = require('../services/deploy-config.service');
const { ensureSudo, keepAlive, stopKeepAlive } = require('../services/sudo.service');

async function runFullstackDeploy({ dryRun = false } = {}) {
  const deployRunner = new Runner({ dryRun });
  const analysisRunner = new Runner({ dryRun: false });
  logger.title('Deploy fullstack');

  const common = await askCommonRepoInfo();
  await ensureCommands(analysisRunner, ['git', 'node', 'npm']);
  const analysisDir = await cloneForAnalysis(analysisRunner, common.repoUrl, common.appName);

  const frontendDefault = await suggestExistingSubdir(analysisDir, ['frontend', 'front', 'client']);
  const backendDefault = await suggestExistingSubdir(analysisDir, ['backend', 'back', 'server', 'api']);
  const listening = await showListeningPorts(analysisRunner);

  const paths = await inquirer.prompt([
    { type: 'input', name: 'domain', message: 'Dominio principal:', validate: validateDomain },
    { type: 'confirm', name: 'includeWww', message: 'Incluir www?', default: true },
    { type: 'input', name: 'frontendPath', message: 'Ruta del frontend dentro del repo:', default: frontendDefault },
    { type: 'input', name: 'backendPath', message: 'Ruta del backend dentro del repo:', default: backendDefault }
  ]);

  const frontendAnalysis = await analyzeNodeProject(path.join(analysisDir, paths.frontendPath));
  const backendAnalysis = await analyzeNodeProject(path.join(analysisDir, paths.backendPath));
  logger.info(`Scripts frontend: ${frontendAnalysis.scriptNames.length ? frontendAnalysis.scriptNames.join(', ') : 'ninguno'}`);
  logger.info(`Scripts backend: ${backendAnalysis.scriptNames.length ? backendAnalysis.scriptNames.join(', ') : 'ninguno'}`);

  const frontendEnvExample = await hasEnvExample(path.join(analysisDir, paths.frontendPath));
  const backendEnvExample = await hasEnvExample(path.join(analysisDir, paths.backendPath));

  const details = await inquirer.prompt([
    {
      type: 'input',
      name: 'port',
      message: 'Puerto interno backend:',
      default: suggestFreePort(listening),
      validate: validatePort,
      filter: Number
    },
    { type: 'input', name: 'apiPath', message: 'API path:', default: '/api', filter: normalizeApiPath },
    { type: 'input', name: 'frontendInstallCommand', message: 'Comando install frontend:', default: frontendAnalysis.installCommand },
    { type: 'input', name: 'frontendBuildCommand', message: 'Comando build frontend:', default: frontendAnalysis.buildCommand || 'npm run build' },
    { type: 'input', name: 'frontendBuildOutputDir', message: 'Carpeta salida frontend:', default: 'dist' },
    { type: 'input', name: 'backendInstallCommand', message: 'Comando install backend:', default: backendAnalysis.installCommand },
    { type: 'input', name: 'backendStartCommand', message: 'Comando start backend:', default: backendAnalysis.startCommand || 'npm start' },
    { type: 'input', name: 'pm2Name', message: 'Nombre PM2:', default: common.appName }
  ]);

  const createFrontendEnv = await askEnvCreation(frontendEnvExample, 'frontend/.env');
  const createBackendEnv = await askEnvCreation(backendEnvExample, 'backend/.env');
  const nginxSsl = await askNginxAndSsl(true);

  const config = {
    ...common,
    ...paths,
    ...details,
    ...nginxSsl,
    createFrontendEnv,
    createBackendEnv,
    publicDir: `/var/www/${common.appName}/frontend`
  };

  const confirmed = await confirmFinalSummary('Resumen fullstack', {
    Repo: config.repoUrl,
    App: config.appName,
    Proyecto: config.projectDir,
    Dominio: config.domain,
    'Incluir www': config.includeWww ? 'si' : 'no',
    Frontend: config.frontendPath,
    Backend: config.backendPath,
    Puerto: config.port,
    'API path': config.apiPath,
    'Destino publico': config.publicDir,
    'Install front': config.frontendInstallCommand,
    'Build front': config.frontendBuildCommand,
    'Install back': config.backendInstallCommand,
    'Start back': config.backendStartCommand,
    PM2: config.pm2Name,
    Nginx: config.configureNginx ? 'si' : 'no',
    SSL: config.enableSsl ? 'si' : 'no',
    DryRun: dryRun ? 'si' : 'no'
  });
  if (!confirmed) throw new Error('Despliegue cancelado por el usuario.');

  await ensureCommands(deployRunner, ['git', 'node', 'npm', 'rsync']);
  await ensurePm2(deployRunner);
  if (config.configureNginx || config.enableSsl) {
    await ensureSudo(deployRunner);
    keepAlive(deployRunner);
    await ensureCommands(deployRunner, ['nginx', 'systemctl']);
  }
  await ensureCertbotIfNeeded(deployRunner, config.enableSsl);

  await ensureProjectRepo(deployRunner, config.repoUrl, config.projectDir);
  const frontendDir = path.join(config.projectDir, config.frontendPath);
  const backendDir = path.join(config.projectDir, config.backendPath);

  await deployRunner.run(...commandTuple(config.frontendInstallCommand), { cwd: frontendDir, message: 'Instalando frontend' });
  if (config.createFrontendEnv && !dryRun) await createEnvFromExample(frontendDir, true, '.env');
  if (config.createFrontendEnv && dryRun) logger.warn('dry-run: creacion de .env frontend omitida');
  await deployRunner.run(...commandTuple(config.frontendBuildCommand), { cwd: frontendDir, message: 'Compilando frontend' });

  const buildDir = path.join(frontendDir, config.frontendBuildOutputDir);
  await deployRunner.run('test', ['-d', buildDir], { message: `Verificando ${buildDir}`, success: 'Build encontrado' });
  await ensureDirWithSudo(deployRunner, config.publicDir);
  await deployRunner.sudo('rsync', ['-av', '--delete', `${buildDir}/`, `${config.publicDir}/`], {
    message: 'Copiando frontend a /var/www',
    success: 'Frontend publicado'
  });

  await deployRunner.run(...commandTuple(config.backendInstallCommand), { cwd: backendDir, message: 'Instalando backend' });
  if (config.createBackendEnv && !dryRun) await createEnvFromExample(backendDir, true, '.env');
  if (config.createBackendEnv && dryRun) logger.warn('dry-run: creacion de .env backend omitida');
  let ecosystemFile;
  if (!dryRun) {
    ecosystemFile = await ensureEcosystemConfig(backendDir, {
      appName: config.pm2Name,
      cwd: backendDir,
      startCommand: config.backendStartCommand,
      port: config.port
    });
  } else {
    logger.warn('dry-run: creacion de ecosystem.config.cjs omitida');
  }
  await startOrRestart(deployRunner, backendDir, config.pm2Name, ecosystemFile);

  if (config.configureNginx) {
    await installSite(deployRunner, config.appName, nginxFullstackTemplate(config));
    await testAndReload(deployRunner);
  }
  if (config.enableSsl) await runCertbot(deployRunner, config.domain, config.includeWww);
  stopKeepAlive();
  if (!dryRun) {
    await writeDeployConfig(config.projectDir, {
      appName: config.appName,
      type: 'fullstack',
      repoUrl: config.repoUrl,
      projectPath: config.projectDir,
      domain: config.domain,
      includeWww: config.includeWww,
      port: config.port,
      pm2Name: config.pm2Name,
      frontendPath: config.frontendPath,
      backendPath: config.backendPath,
      apiPath: config.apiPath,
      frontendInstallCommand: config.frontendInstallCommand,
      frontendBuildCommand: config.frontendBuildCommand,
      frontendBuildOutputDir: config.frontendBuildOutputDir,
      backendInstallCommand: config.backendInstallCommand,
      startCommand: config.backendStartCommand,
      ecosystemFile: 'ecosystem.config.cjs',
      publicDir: config.publicDir,
      nginxEnabled: Boolean(config.configureNginx),
      nginxConfig: `/etc/nginx/sites-available/${config.appName}`,
      sslEnabled: Boolean(config.enableSsl)
    });
  }

  logger.success('Deploy fullstack completado.');
}

function commandTuple(command) {
  const parts = splitCommand(command);
  if (!parts.length) throw new Error('Comando vacio.');
  return [parts[0], parts.slice(1)];
}

module.exports = {
  runFullstackDeploy
};
