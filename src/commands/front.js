const path = require('path');
const inquirer = require('inquirer');
const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { validateDomain, validateAbsolutePath } = require('../core/validators');
const { askCommonRepoInfo, askEnvCreation, askNginxAndSsl, confirmFinalSummary } = require('../core/prompts');
const { cloneForAnalysis, ensureProjectRepo } = require('../services/git.service');
const { analyzeNodeProject, splitCommand } = require('../services/package.service');
const { hasEnvExample, ensureDirWithSudo } = require('../services/filesystem.service');
const { createEnvFromExample } = require('../services/env.service');
const { ensureCommands, ensureCertbotIfNeeded } = require('../services/preflight.service');
const { installSite, testAndReload } = require('../services/nginx.service');
const { runCertbot } = require('../services/certbot.service');
const { nginxFrontTemplate } = require('../templates/nginx.front.template');
const { writeDeployConfig } = require('../services/deploy-config.service');
const { ensureSudo, keepAlive, stopKeepAlive } = require('../services/sudo.service');

async function runFrontDeploy({ dryRun = false } = {}) {
  const deployRunner = new Runner({ dryRun });
  const analysisRunner = new Runner({ dryRun: false });
  logger.title('Deploy frontend');

  const common = await askCommonRepoInfo();
  await ensureCommands(analysisRunner, ['git', 'node', 'npm']);
  const analysisDir = await cloneForAnalysis(analysisRunner, common.repoUrl, common.appName);
  const analysis = await analyzeNodeProject(analysisDir);
  logger.info(`Scripts detectados: ${analysis.scriptNames.length ? analysis.scriptNames.join(', ') : 'ninguno'}`);
  if (!analysis.buildCommand) logger.warn('No se detecto script build; tendras que indicar el comando.');

  const envExample = await hasEnvExample(analysisDir);
  const answers = await inquirer.prompt([
    { type: 'input', name: 'domain', message: 'Dominio:', validate: validateDomain },
    { type: 'confirm', name: 'includeWww', message: 'Incluir www en Nginx/Certbot?', default: false },
    {
      type: 'input',
      name: 'publicDir',
      message: 'Carpeta publica destino:',
      default: `/var/www/${common.appName}`,
      validate: validateAbsolutePath
    },
    { type: 'input', name: 'installCommand', message: 'Comando de instalacion:', default: analysis.installCommand },
    { type: 'input', name: 'buildCommand', message: 'Comando de build:', default: analysis.buildCommand || 'npm run build' },
    { type: 'input', name: 'buildOutputDir', message: 'Carpeta de salida del build:', default: 'dist' }
  ]);
  const createEnv = await askEnvCreation(envExample, '.env.production');
  const nginxSsl = await askNginxAndSsl(true);

  const config = { ...common, ...answers, ...nginxSsl, createEnv };
  const confirmed = await confirmFinalSummary('Resumen frontend', {
    Repo: config.repoUrl,
    App: config.appName,
    Proyecto: config.projectDir,
    Dominio: config.domain,
    'Incluir www': config.includeWww ? 'si' : 'no',
    'Destino publico': config.publicDir,
    Instalar: config.installCommand,
    Build: config.buildCommand,
    'Salida build': config.buildOutputDir,
    Nginx: config.configureNginx ? 'si' : 'no',
    SSL: config.enableSsl ? 'si' : 'no',
    DryRun: dryRun ? 'si' : 'no'
  });
  if (!confirmed) throw new Error('Despliegue cancelado por el usuario.');

  await ensureCommands(deployRunner, ['git', 'node', 'npm', 'rsync']);
  if (config.configureNginx || config.enableSsl) {
    await ensureSudo(deployRunner);
    keepAlive(deployRunner);
    await ensureCommands(deployRunner, ['nginx', 'systemctl']);
  }
  await ensureCertbotIfNeeded(deployRunner, config.enableSsl);

  await ensureProjectRepo(deployRunner, config.repoUrl, config.projectDir);
  if (config.createEnv && !dryRun) await createEnvFromExample(config.projectDir, true, '.env.production');
  if (config.createEnv && dryRun) logger.warn('dry-run: creacion de .env.production omitida');
  await deployRunner.run(...commandTuple(config.installCommand), { cwd: config.projectDir, message: 'Instalando dependencias' });
  await deployRunner.run(...commandTuple(config.buildCommand), { cwd: config.projectDir, message: 'Compilando frontend' });

  const buildDir = path.join(config.projectDir, config.buildOutputDir);
  await deployRunner.run('test', ['-d', buildDir], {
    message: `Verificando ${buildDir}`,
    success: 'Build encontrado'
  });
  await ensureDirWithSudo(deployRunner, config.publicDir);
  await deployRunner.sudo('rsync', ['-av', '--delete', `${buildDir}/`, `${config.publicDir}/`], {
    message: 'Copiando build a /var/www',
    success: 'Frontend publicado'
  });

  if (config.configureNginx) {
    await installSite(deployRunner, config.appName, nginxFrontTemplate(config));
    await testAndReload(deployRunner);
  }
  if (config.enableSsl) await runCertbot(deployRunner, config.domain, config.includeWww);
  stopKeepAlive();
  if (!dryRun) {
    await writeDeployConfig(config.projectDir, {
      appName: config.appName,
      type: 'front',
      repoUrl: config.repoUrl,
      projectPath: config.projectDir,
      domain: config.domain,
      includeWww: config.includeWww,
      installCommand: config.installCommand,
      buildCommand: config.buildCommand,
      buildOutputDir: config.buildOutputDir,
      publicDir: config.publicDir,
      nginxEnabled: Boolean(config.configureNginx),
      nginxConfig: `/etc/nginx/sites-available/${config.appName}`,
      sslEnabled: Boolean(config.enableSsl)
    });
  }

  logger.success('Deploy frontend completado.');
}

function commandTuple(command) {
  const parts = splitCommand(command);
  if (!parts.length) throw new Error('Comando vacio.');
  return [parts[0], parts.slice(1)];
}

module.exports = {
  runFrontDeploy
};
