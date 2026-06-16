const inquirer = require('inquirer');
const fs = require('fs-extra');
const { Runner } = require('../core/runner');
const { logger } = require('../core/logger');
const { validateDomain, validatePort } = require('../core/validators');
const { askCommonRepoInfo, askEnvCreation, askNginxAndSsl, confirmFinalSummary } = require('../core/prompts');
const { cloneForAnalysis, ensureProjectRepo } = require('../services/git.service');
const { analyzeNodeProject, splitCommand } = require('../services/package.service');
const { hasEnvExample } = require('../services/filesystem.service');
const { createEnvFromExample } = require('../services/env.service');
const { showListeningPorts, suggestFreePort } = require('../services/ports.service');
const { isPortOccupied } = require('../services/ports.service');
const { ensureCommands, ensurePm2, ensureCertbotIfNeeded } = require('../services/preflight.service');
const { ensureEcosystemConfig, startOrRestart, showLogs } = require('../services/pm2.service');
const { installSite, testAndReload } = require('../services/nginx.service');
const { runCertbot } = require('../services/certbot.service');
const { nginxBackTemplate } = require('../templates/nginx.back.template');
const { inspectProject, printProjectState } = require('../services/state.service');
const { continueBackPending, updateProject, repairBackProject, commandSeemsBuildRequired } = require('../services/deploy-ops.service');
const { readDeployConfig, writeDeployConfig } = require('../services/deploy-config.service');
const { preflightRepoAccess } = require('../services/github-ssh.service');
const { inspectEnvFile } = require('../services/env-check.service');
const { ensureSudo, keepAlive, stopKeepAlive } = require('../services/sudo.service');

async function runBackDeploy({ dryRun = false } = {}) {
  const deployRunner = new Runner({ dryRun });
  const analysisRunner = new Runner({ dryRun: false });
  logger.title('Deploy backend');

  const common = await askCommonRepoInfo();
  if (await fs.pathExists(common.projectDir)) {
    await handleExistingBackProject(deployRunner, analysisRunner, common, dryRun);
    return;
  }

  await runNewBackDeploy(deployRunner, analysisRunner, common, dryRun);
}

async function runNewBackDeploy(deployRunner, analysisRunner, common, dryRun) {
  await ensureCommands(analysisRunner, ['git', 'node', 'npm']);
  common.repoUrl = await preflightRepoAccess(analysisRunner, common.repoUrl);
  const analysisDir = await cloneForAnalysis(analysisRunner, common.repoUrl, common.appName);
  const analysis = await analyzeNodeProject(analysisDir);
  logger.info(`Scripts detectados: ${analysis.scriptNames.length ? analysis.scriptNames.join(', ') : 'ninguno'}`);
  const suggestedStartCommand = analysis.startCommand || 'npm start';
  const suggestedStartUsesDist = commandOrScriptUsesDist(suggestedStartCommand, analysis.scripts);
  if (suggestedStartUsesDist && !analysis.buildCommand) {
    logger.warn('El comando de start parece usar dist/, pero no se detecto script build.');
  }

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
    { type: 'input', name: 'startCommand', message: 'Comando de start:', default: suggestedStartCommand },
    {
      type: 'confirm',
      name: 'runBuild',
      message: (answersSoFar) => commandOrScriptUsesDist(answersSoFar.startCommand, analysis.scripts)
        ? 'El start parece usar dist/. Ejecutar build antes de PM2 es obligatorio. Continuar ejecutando build?'
        : 'Se detecto script build. Ejecutarlo antes de iniciar PM2?',
      default: true,
      when: (answersSoFar) => Boolean(analysis.buildCommand || commandOrScriptUsesDist(answersSoFar.startCommand, analysis.scripts))
    },
    {
      type: 'input',
      name: 'buildCommand',
      message: 'Comando de build:',
      default: analysis.buildCommand || 'npm run build',
      when: (answersSoFar) => Boolean(answersSoFar.runBuild)
    },
    { type: 'input', name: 'pm2Name', message: 'Nombre PM2:', default: common.appName }
  ]);
  if (isPortOccupied(listening, answers.port)) {
    logger.warn(`El puerto ${answers.port} parece estar ocupado.`);
    const { useOccupied } = await inquirer.prompt([
      { type: 'confirm', name: 'useOccupied', message: 'Quieres continuar usando ese puerto?', default: false }
    ]);
    if (!useOccupied) throw new Error('Elige otro puerto y vuelve a ejecutar el despliegue.');
  }
  if (commandOrScriptUsesDist(answers.startCommand, analysis.scripts) && !answers.runBuild) {
    logger.warn('El start usa dist/. Se activara build antes de PM2 porque es obligatorio para este tipo de arranque.');
    answers.runBuild = true;
    const { mandatoryBuildCommand } = await inquirer.prompt([
      {
        type: 'input',
        name: 'mandatoryBuildCommand',
        message: 'Comando de build obligatorio:',
        default: analysis.buildCommand || 'npm run build'
      }
    ]);
    answers.buildCommand = mandatoryBuildCommand;
  }
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
    Build: config.runBuild ? config.buildCommand : 'no',
    Start: config.startCommand,
    PM2: config.pm2Name,
    Nginx: config.configureNginx ? 'si' : 'no',
    SSL: config.enableSsl ? 'si' : 'no',
    DryRun: dryRun ? 'si' : 'no'
  });
  if (!confirmed) throw new Error('Despliegue cancelado por el usuario.');

  await ensureCommands(deployRunner, ['git', 'node', 'npm']);
  await ensurePm2(deployRunner);
  if (config.configureNginx || config.enableSsl) {
    await ensureSudo(deployRunner);
    keepAlive(deployRunner);
    await ensureCommands(deployRunner, ['nginx', 'systemctl']);
  }
  await ensureCertbotIfNeeded(deployRunner, config.enableSsl);

  await ensureProjectRepo(deployRunner, config.repoUrl, config.projectDir);
  try {
    await runBackStep(config, dryRun, 'install', async () => {
      await deployRunner.run(...commandTuple(config.installCommand), { cwd: config.projectDir, message: 'Instalando dependencias' });
    });
    if (config.runBuild) {
      await runBackStep(config, dryRun, 'build', async () => {
        await deployRunner.run(...commandTuple(config.buildCommand), { cwd: config.projectDir, message: 'Compilando backend' });
      });
    }
    await runBackStep(config, dryRun, 'env', async () => {
      if (config.createEnv && !dryRun) await createEnvFromExample(config.projectDir, true, '.env');
      if (config.createEnv && dryRun) logger.warn('dry-run: creacion de .env omitida');
      if (!dryRun) await inspectAndOfferEnvEdit(config.projectDir, deployRunner);
    });
    let ecosystemFile;
    await runBackStep(config, dryRun, 'ecosystem', async () => {
      if (!dryRun) {
        ecosystemFile = await ensureEcosystemConfig(config.projectDir, {
          appName: config.pm2Name,
          cwd: config.projectDir,
          startCommand: config.startCommand,
          port: config.port
        });
      } else {
        logger.warn('dry-run: creacion de ecosystem.config.cjs omitida');
      }
    });
    await runBackStep(config, dryRun, 'pm2_start', async () => {
      await startOrRestart(deployRunner, config.projectDir, config.pm2Name, ecosystemFile);
    });
    if (config.configureNginx) {
      await runBackStep(config, dryRun, 'nginx', async () => {
        await installSite(deployRunner, config.appName, nginxBackTemplate(config));
        await testAndReload(deployRunner);
      });
    }
    if (config.enableSsl) {
      await runBackStep(config, dryRun, 'certbot', async () => {
        await runCertbot(deployRunner, config.domain, false);
      });
    }
    stopKeepAlive();
    await showLogs(deployRunner, config.pm2Name);
    if (!dryRun) await persistBackConfig({ ...config, status: 'ok', lastStep: 'completed', lastError: '' });
  } catch (error) {
    stopKeepAlive();
    if (!dryRun) await persistBackConfig({ ...config, status: 'partial', lastError: error.message });
    throw error;
  }

  logger.success('Deploy backend completado.');
}

async function inspectAndOfferEnvEdit(projectPath, runner) {
  const env = await inspectEnvFile(projectPath);
  if (!env.exists || !env.empty.length) return;
  logger.warn('Variables pendientes de completar:');
  for (const key of env.empty) console.log(`- ${key}`);
  const { edit } = await inquirer.prompt([
    { type: 'confirm', name: 'edit', message: 'Quieres abrir nano para editar .env ahora?', default: false }
  ]);
  if (edit) {
    await runner.run('nano', ['.env'], { cwd: projectPath, stdio: 'inherit', spinner: false });
  }
}

async function handleExistingBackProject(deployRunner, analysisRunner, common, dryRun) {
  const existingConfig = (await readDeployConfig(common.projectDir)) || {};
  const state = await inspectProject(analysisRunner, {
    ...existingConfig,
    appName: common.appName,
    repoUrl: common.repoUrl,
    projectPath: common.projectDir,
    type: 'back'
  });
  logger.title('Proyecto existente detectado');
  printProjectState(state);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'He detectado que el proyecto ya existe. Que quieres hacer?',
      choices: [
        { name: 'Continuar despliegue pendiente', value: 'continue' },
        { name: 'Actualizar desde GitHub', value: 'update' },
        { name: 'Reparar configuracion', value: 'repair' },
        { name: 'Ver estado', value: 'status' },
        { name: 'Cancelar', value: 'cancel' }
      ]
    }
  ]);

  if (action === 'cancel') throw new Error('Operacion cancelada.');
  if (action === 'status') return;

  const config = await completeExistingBackConfig(common, existingConfig, state);
  await ensureCommands(deployRunner, ['git', 'node', 'npm']);
  await ensurePm2(deployRunner);
  if (config.configureNginx || config.nginxEnabled || config.enableSsl || config.sslEnabled) {
    await ensureSudo(deployRunner);
    keepAlive(deployRunner);
    await ensureCommands(deployRunner, ['nginx', 'systemctl']);
  }
  await ensureCertbotIfNeeded(deployRunner, config.enableSsl || config.sslEnabled);

  if (action === 'update') {
    await updateProject(deployRunner, config, state);
  }
  if (action === 'repair') {
    await repairBackProject(deployRunner, config, state);
  }
  if (action === 'continue') {
    await continueBackPending(deployRunner, config, state);
  }
  if (!dryRun) await persistBackConfig(config);
  stopKeepAlive();
}

async function completeExistingBackConfig(common, existingConfig, state) {
  const analysis = state.packageJson ? await analyzeNodeProject(common.projectDir) : { scripts: {}, installCommand: 'npm install', buildCommand: '', startCommand: 'npm start' };
  const defaultStart = existingConfig.startCommand || analysis.startCommand || 'npm start';
  const buildRequired = commandOrScriptUsesDist(defaultStart, analysis.scripts) || commandSeemsBuildRequired(defaultStart);
  if (buildRequired) logger.warn(`El start usa artefactos compilados. El build parece obligatorio.`);

  const answers = await inquirer.prompt([
    { type: 'input', name: 'domain', message: 'Dominio o subdominio:', default: existingConfig.domain || state.domain, validate: validateDomain },
    {
      type: 'input',
      name: 'port',
      message: 'Puerto interno del backend:',
      default: existingConfig.port || state.port || 3000,
      validate: validatePort,
      filter: Number
    },
    { type: 'input', name: 'installCommand', message: 'Comando de instalacion:', default: existingConfig.installCommand || analysis.installCommand },
    { type: 'input', name: 'startCommand', message: 'Comando de start:', default: defaultStart },
    {
      type: 'confirm',
      name: 'runBuild',
      message: (answersSoFar) => commandOrScriptUsesDist(answersSoFar.startCommand, analysis.scripts) || commandSeemsBuildRequired(answersSoFar.startCommand)
        ? 'El start parece usar dist/build/server compilado. Ejecutar build antes de PM2?'
        : 'He detectado script build. Ejecutarlo antes de iniciar PM2?',
      default: true,
      when: (answersSoFar) => Boolean(analysis.buildCommand || commandOrScriptUsesDist(answersSoFar.startCommand, analysis.scripts) || commandSeemsBuildRequired(answersSoFar.startCommand))
    },
    {
      type: 'input',
      name: 'buildCommand',
      message: 'Comando de build:',
      default: existingConfig.buildCommand || analysis.buildCommand || 'npm run build',
      when: (answersSoFar) => Boolean(answersSoFar.runBuild)
    },
    { type: 'input', name: 'pm2Name', message: 'Nombre PM2:', default: existingConfig.pm2Name || state.pm2Name || common.appName },
    { type: 'confirm', name: 'configureNginx', message: 'Configurar o reparar Nginx?', default: existingConfig.nginxEnabled !== false },
    { type: 'confirm', name: 'enableSsl', message: 'Activar SSL con Certbot si falta?', default: Boolean(existingConfig.sslEnabled) }
  ]);

  if ((commandOrScriptUsesDist(answers.startCommand, analysis.scripts) || commandSeemsBuildRequired(answers.startCommand)) && !answers.runBuild) {
    logger.warn('El start usa salida compilada. Se activara build para evitar arrancar artefactos inexistentes.');
    answers.runBuild = true;
    answers.buildCommand = answers.buildCommand || existingConfig.buildCommand || analysis.buildCommand || 'npm run build';
  }

  return {
    ...existingConfig,
    ...common,
    ...answers,
    type: 'back',
    projectPath: common.projectDir,
    nginxEnabled: answers.configureNginx,
    sslEnabled: answers.enableSsl,
    ecosystemFile: 'ecosystem.config.cjs'
  };
}

async function persistBackConfig(config) {
  await writeDeployConfig(config.projectPath || config.projectDir, {
    appName: config.appName,
    type: 'back',
    repoUrl: config.repoUrl,
    projectPath: config.projectPath || config.projectDir,
    domain: config.domain,
    port: config.port,
    pm2Name: config.pm2Name,
    installCommand: config.installCommand,
    buildCommand: config.runBuild ? config.buildCommand : config.buildCommand,
    startCommand: config.startCommand,
    ecosystemFile: 'ecosystem.config.cjs',
    nginxEnabled: Boolean(config.configureNginx || config.nginxEnabled),
    nginxConfig: `/etc/nginx/sites-available/${config.appName}`,
    sslEnabled: Boolean(config.enableSsl || config.sslEnabled),
    status: config.status,
    lastStep: config.lastStep,
    lastError: config.lastError
  });
}

async function runBackStep(config, dryRun, step, fn) {
  try {
    config.lastStep = step;
    await fn();
  } catch (error) {
    config.lastStep = step;
    config.lastError = error.message;
    throw error;
  }
}

function commandTuple(command) {
  const parts = splitCommand(command);
  if (!parts.length) throw new Error('Comando vacio.');
  return [parts[0], parts.slice(1)];
}

function commandUsesDist(command) {
  return /(^|\s|["'])\.?\/?dist\//.test(String(command || ''));
}

function commandOrScriptUsesDist(command, scripts) {
  if (commandUsesDist(command)) return true;
  const scriptName = scriptNameFromCommand(command);
  return scriptName ? commandUsesDist(scripts[scriptName]) : false;
}

function scriptNameFromCommand(command) {
  const parts = splitCommand(command);
  if (parts[0] === 'npm' && parts[1] === 'start') return 'start';
  if (parts[0] === 'npm' && parts[1] === 'run' && parts[2]) return parts[2];
  if (parts[0] === 'yarn' && parts[1]) return parts[1];
  if (parts[0] === 'pnpm' && parts[1]) return parts[1] === 'run' ? parts[2] : parts[1];
  return null;
}

module.exports = {
  runBackDeploy,
  commandUsesDist,
  commandOrScriptUsesDist
};
