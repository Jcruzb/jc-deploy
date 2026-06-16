const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const { logger } = require('../core/logger');
const { splitCommand, analyzeNodeProject } = require('./package.service');
const { ecosystemPath, ensureEcosystemConfig, startOrRestart } = require('./pm2.service');
const { installSite, testAndReload } = require('./nginx.service');
const { nginxBackTemplate } = require('../templates/nginx.back.template');
const { runCertbot, certificateExists } = require('./certbot.service');
const { writeDeployConfig } = require('./deploy-config.service');
const { warnIfDnsMismatch } = require('./dns.service');

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
  if (config.type === 'back' || config.type === 'fullstack') {
    await ensureBuildBeforePm2(runner, config, {
      projectPath: analysisPath,
      state,
      analysis,
      promptWhenOptional: true
    });
  } else if (analysis.scripts.build && config.buildCommand) {
    const shouldBuild = config.type === 'front';
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
  const analysis = state.packageJson ? await analyzeNodeProject(projectPath) : { scripts: {} };
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
      const buildReady = await ensureBuildBeforePm2(runner, config, {
        projectPath,
        state,
        analysis,
        promptWhenOptional: false
      });
      if (!buildReady) return;
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

  await maybeOfferSslActivation(runner, config, state);

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
  return /(dist\/|build\/|server\.cjs|(^|\s|["'])server\.js|main\.js)/.test(String(command || ''));
}

function startDependsOnBuild(startCommand, scripts = {}) {
  if (commandSeemsBuildRequired(startCommand)) return true;
  const command = String(startCommand || '').trim();
  if (command === 'npm start') return commandSeemsBuildRequired(scripts.start);
  const npmRun = command.match(/^npm\s+run\s+([\w:-]+)/);
  if (npmRun) return commandSeemsBuildRequired(scripts[npmRun[1]]);
  return false;
}

function shouldOfferSslActivation(config, state) {
  return Boolean(
    config.domain &&
    !config.sslEnabled &&
    state.nginxConfig &&
    state.nginxEnabled &&
    state.ssl !== 'si'
  );
}

async function maybeOfferSslActivation(runner, config, state) {
  if (!shouldOfferSslActivation(config, state)) return false;

  const nginxOk = await validateNginxConfig(runner);
  if (!nginxOk) {
    logger.warn('Nginx no pasa nginx -t. No se activara SSL hasta corregir la configuracion.');
    return false;
  }

  const dnsOk = await warnIfDnsMismatch(runner, config.domain);
  if (!dnsOk) {
    logger.warn('El dominio no parece apuntar a esta VPS. No se activara SSL automaticamente.');
    return false;
  }

  const httpOk = await validateHttpPort80(runner, config.domain);
  if (!httpOk) {
    logger.warn(`No se pudo acceder a http://${config.domain} por puerto 80. No se activara SSL.`);
    return false;
  }

  if (await certificateExists(runner, config.domain)) {
    logger.warn(`Ya existe un certificado Certbot para ${config.domain}. No se creara duplicado.`);
    return false;
  }

  const { enableSsl } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableSsl',
      message: `Nginx funciona por HTTP y SSL esta desactivado. Activar SSL con Certbot para ${config.domain}?`,
      default: true
    }
  ]);
  if (!enableSsl) return false;

  await runner.sudo('certbot', ['--nginx', '-d', config.domain], {
    message: 'Activando SSL con Certbot',
    success: 'SSL configurado'
  });
  config.sslEnabled = true;
  config.status = 'online';
  state.ssl = 'si';
  return true;
}

async function validateNginxConfig(runner) {
  try {
    await runner.sudo('nginx', ['-t'], {
      spinner: false,
      display: 'sudo nginx -t'
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function validateHttpPort80(runner, domain) {
  try {
    await runner.run('curl', ['-I', '--max-time', '10', `http://${domain}`], {
      spinner: false,
      display: `curl -I --max-time 10 http://${domain}`,
      timeout: 15000
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureBuildBeforePm2(runner, config, { projectPath, state, analysis, promptWhenOptional }) {
  const scripts = analysis.scripts || {};
  const buildCommand = config.buildCommand || (scripts.build ? 'npm run build' : '');
  const required = startDependsOnBuild(config.startCommand || scripts.start, scripts);
  const distExists = await fs.pathExists(path.join(projectPath, 'dist'));
  const missingDist = state ? (!state.dist || !distExists) : !distExists;

  if (!scripts.build || !buildCommand) return true;
  if (!missingDist && !required && !promptWhenOptional) return true;

  let shouldBuild = false;
  if (missingDist && required) {
    const { build } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'build',
        message: 'No existe dist y el start parece depender de dist/server.cjs. Ejecutar npm run build ahora?',
        default: true
      }
    ]);
    shouldBuild = build;
    if (!shouldBuild) {
      logger.warn('Build obligatorio rechazado. No se iniciara PM2 para evitar una app en errored.');
      return false;
    }
  } else if (promptWhenOptional) {
    const { build } = await inquirer.prompt([
      { type: 'confirm', name: 'build', message: 'Ejecutar build antes de reiniciar PM2?', default: required }
    ]);
    shouldBuild = build;
  }

  if (!shouldBuild) return true;

  try {
    await runCommand(runner, buildCommand, projectPath, 'Ejecutando build antes de PM2');
    if (state) state.dist = true;
    return true;
  } catch (error) {
    if (!runner.dryRun) {
      await writeDeployConfig(config.projectPath || projectPath, {
        ...config,
        status: 'partial',
        lastStep: 'build',
        lastError: error.message
      });
    }
    throw error;
  }
}

module.exports = {
  continueBackPending,
  updateProject,
  repairBackProject,
  runCommand,
  commandSeemsBuildRequired,
  startDependsOnBuild,
  ensureBuildBeforePm2,
  shouldOfferSslActivation,
  maybeOfferSslActivation
};
