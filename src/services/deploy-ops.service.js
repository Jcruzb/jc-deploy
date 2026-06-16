const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const { logger } = require('../core/logger');
const { splitCommand, analyzeNodeProject } = require('./package.service');
const { ecosystemPath, ensureEcosystemConfig, startOrRestart } = require('./pm2.service');
const { installSite, testAndReload } = require('./nginx.service');
const { nginxBackTemplate } = require('../templates/nginx.back.template');
const { runCertbot } = require('./certbot.service');
const { writeDeployConfig } = require('./deploy-config.service');

async function continueBackPending(runner, config, state) {
  const projectPath = config.projectPath || config.projectDir;
  const analysis = state.packageJson ? await analyzeNodeProject(projectPath) : null;
  if (!state.nodeModules && config.installCommand) {
    await runCommand(runner, config.installCommand, projectPath, 'Instalando dependencias pendientes');
  }
  if (!state.dist && config.buildCommand && analysis && analysis.scripts.build) {
    await runCommand(runner, config.buildCommand, projectPath, 'Ejecutando build pendiente');
  }
  await repairBackProject(runner, { ...config, projectPath }, state, { onlyMissing: true });
}

async function updateProject(runner, config, state) {
  if (!state.isGitRepo) throw new Error('No es una repo Git. No se puede actualizar desde GitHub.');
  if (state.hasLocalChanges) {
    logger.warn('Hay cambios locales sin confirmar:');
    console.log(state.gitStatus);
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Continuar con git pull aun con cambios locales?',
        default: false
      }
    ]);
    if (!proceed) throw new Error('Actualizacion cancelada por cambios locales.');
  }

  const before = await gitHead(runner, config.projectPath);
  await runner.run('git', ['pull', '--ff-only'], {
    cwd: config.projectPath,
    message: 'Actualizando desde GitHub',
    success: 'Repo actualizada'
  });
  const after = await gitHead(runner, config.projectPath);
  const changedFiles = before && after && before !== after
    ? await gitChangedFiles(runner, config.projectPath, before, after)
    : [];

  const lockChanged = changedFiles.some((file) => ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(file));
  if (lockChanged && config.installCommand) {
    await runCommand(runner, config.installCommand, config.projectPath, 'Instalando dependencias por cambios en package/lock');
  } else if (config.installCommand) {
    const { install } = await inquirer.prompt([
      { type: 'confirm', name: 'install', message: 'Ejecutar comando de instalacion?', default: false }
    ]);
    if (install) await runCommand(runner, config.installCommand, config.projectPath, 'Instalando dependencias');
  }

  const analysisPath = config.type === 'fullstack' && config.backendPath
    ? path.join(config.projectPath, config.backendPath)
    : config.projectPath;
  const analysis = await analyzeNodeProject(analysisPath);
  if (analysis.scripts.build && config.buildCommand) {
    const shouldBuild = config.type === 'front' || config.type === 'fullstack' || commandSeemsBuildRequired(config.startCommand);
    const { build } = await inquirer.prompt([
      { type: 'confirm', name: 'build', message: 'Ejecutar build?', default: shouldBuild }
    ]);
    if (build) await runCommand(runner, config.buildCommand, analysisPath, 'Ejecutando build');
  }

  if (config.type === 'front' && config.publicDir && config.buildOutputDir) {
    const buildDir = path.join(config.projectPath, config.buildOutputDir);
    await runner.run('test', ['-d', buildDir], { message: `Verificando ${buildDir}`, success: 'Build encontrado' });
    await runner.sudo('rsync', ['-av', '--delete', `${buildDir}/`, `${config.publicDir}/`], {
      message: 'Copiando build a /var/www',
      success: 'Frontend publicado'
    });
  }

  if (config.type === 'fullstack' && config.publicDir && config.frontendPath && config.frontendBuildOutputDir) {
    const buildDir = path.join(config.projectPath, config.frontendPath, config.frontendBuildOutputDir);
    await runner.run('test', ['-d', buildDir], { message: `Verificando ${buildDir}`, success: 'Build encontrado' });
    await runner.sudo('rsync', ['-av', '--delete', `${buildDir}/`, `${config.publicDir}/`], {
      message: 'Copiando frontend a /var/www',
      success: 'Frontend publicado'
    });
  }

  if (config.type === 'back' || config.type === 'fullstack') {
    const pm2Cwd = config.type === 'fullstack' && config.backendPath
      ? path.join(config.projectPath, config.backendPath)
      : config.projectPath;
    await startOrRestart(runner, pm2Cwd, config.pm2Name || config.appName, path.join(pm2Cwd, config.ecosystemFile || 'ecosystem.config.cjs'));
  }
  if (config.nginxEnabled) await testAndReload(runner);
  if (!runner.dryRun) await writeDeployConfig(config.projectPath, config);
}

async function repairBackProject(runner, config, state, options = {}) {
  const projectPath = config.projectPath;
  if (state.ecosystemJs && state.typeModule) {
    const oldPath = path.join(projectPath, 'ecosystem.config.js');
    const newPath = ecosystemPath(projectPath);
    if (!(await fs.pathExists(newPath))) {
      if (runner.dryRun) {
        logger.warn(`dry-run: se renombraria ${oldPath} a ${newPath}`);
      } else {
        await fs.move(oldPath, newPath);
        logger.success(`Renombrado ${oldPath} a ${newPath}`);
      }
    }
  }

  if (!options.onlyMissing || !state.ecosystemCjs) {
    const { regenerate } = options.onlyMissing
      ? { regenerate: true }
      : await inquirer.prompt([
        { type: 'confirm', name: 'regenerate', message: 'Regenerar ecosystem.config.cjs?', default: true }
      ]);
    if (regenerate) {
      if (runner.dryRun) {
        logger.warn('dry-run: se regeneraria ecosystem.config.cjs');
      } else {
        await fs.remove(ecosystemPath(projectPath));
        await ensureEcosystemConfig(projectPath, {
          appName: config.pm2Name || config.appName,
          cwd: projectPath,
          startCommand: config.startCommand || 'npm start',
          port: config.port
        });
      }
    }
  }

  if (!options.onlyMissing || !state.pm2 || !state.pm2.exists) {
    const shouldRestart = options.onlyMissing
      ? true
      : (await inquirer.prompt([
        { type: 'confirm', name: 'restart', message: 'Iniciar o reiniciar PM2?', default: true }
      ])).restart;
    if (shouldRestart) {
      await startOrRestart(runner, projectPath, config.pm2Name || config.appName, ecosystemPath(projectPath));
    }
  }

  if (config.domain && (!options.onlyMissing || !state.nginxConfig || !state.nginxEnabled)) {
    const shouldNginx = options.onlyMissing
      ? true
      : (await inquirer.prompt([
        { type: 'confirm', name: 'nginx', message: 'Regenerar configuracion Nginx?', default: true }
      ])).nginx;
    if (shouldNginx) {
      await installSite(runner, config.appName, nginxBackTemplate({
        domain: config.domain,
        port: config.port
      }));
      await testAndReload(runner);
    }
  } else if (state.nginxEnabled) {
    await testAndReload(runner);
  }

  if (config.sslEnabled && config.domain && state.ssl !== 'si') {
    await runCertbot(runner, config.domain, false);
  }

  if (!runner.dryRun) {
    await writeDeployConfig(projectPath, {
      ...config,
      ecosystemFile: 'ecosystem.config.cjs',
      nginxEnabled: Boolean(config.domain),
      nginxConfig: `/etc/nginx/sites-available/${config.appName}`
    });
  }
}

async function gitHead(runner, cwd) {
  try {
    const result = await runner.run('git', ['rev-parse', 'HEAD'], { cwd, spinner: false, display: 'git rev-parse HEAD' });
    return result.stdout.trim();
  } catch (_) {
    return '';
  }
}

async function gitChangedFiles(runner, cwd, before, after) {
  try {
    const result = await runner.run('git', ['diff', '--name-only', before, after], {
      cwd,
      spinner: false,
      display: `git diff --name-only ${before} ${after}`
    });
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function runCommand(runner, command, cwd, message) {
  const parts = splitCommand(command);
  if (!parts.length) throw new Error('Comando vacio.');
  return runner.run(parts[0], parts.slice(1), { cwd, message });
}

function commandSeemsBuildRequired(command) {
  return /(dist\/|build\/|server\.cjs|server\.js)/.test(String(command || ''));
}

module.exports = {
  continueBackPending,
  updateProject,
  repairBackProject,
  runCommand,
  commandSeemsBuildRequired
};
