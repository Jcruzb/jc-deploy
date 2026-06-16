const path = require('path');
const { splitCommand } = require('./package.service');
const { writeFileIfMissing } = require('./filesystem.service');
const { pm2EcosystemTemplate } = require('../templates/pm2.ecosystem.template');
const { logger } = require('../core/logger');

function ecosystemPath(projectDir) {
  return path.join(projectDir, 'ecosystem.config.js');
}

function commandToPm2(command) {
  const parts = splitCommand(command);
  if (!parts.length) return { script: 'npm', args: 'start' };
  if (parts[0] === 'npm') return { script: 'npm', args: parts.slice(1).join(' ') };
  if (parts[0] === 'yarn') return { script: 'yarn', args: parts.slice(1).join(' ') };
  if (parts[0] === 'pnpm') return { script: 'pnpm', args: parts.slice(1).join(' ') };
  return { script: parts[0], args: parts.slice(1).join(' ') };
}

async function ensureEcosystemConfig(projectDir, options) {
  const target = ecosystemPath(projectDir);
  const created = await writeFileIfMissing(target, pm2EcosystemTemplate(options));
  if (created) logger.success(`Creado ${target}`);
  else logger.warn(`Ya existe ${target}; no se sobrescribio.`);
  return target;
}

async function startOrRestart(runner, projectDir, appName) {
  const target = ecosystemPath(projectDir);
  try {
    await runner.run('pm2', ['describe', appName], {
      cwd: projectDir,
      spinner: false,
      display: `pm2 describe ${appName}`
    });
    await runner.run('pm2', ['restart', appName], {
      cwd: projectDir,
      message: 'Reiniciando app con PM2',
      success: 'App reiniciada'
    });
  } catch (_) {
    await runner.run('pm2', ['start', target], {
      cwd: projectDir,
      message: 'Iniciando app con PM2',
      success: 'App iniciada'
    });
  }
  await runner.run('pm2', ['save'], {
    message: 'Guardando estado PM2',
    success: 'PM2 guardado'
  });
}

async function showLogs(runner, appName) {
  await runner.run('pm2', ['status'], { spinner: false, stdio: 'inherit' });
  await runner.run('pm2', ['logs', appName, '--lines', '50'], { spinner: false, stdio: 'inherit' });
}

module.exports = {
  commandToPm2,
  ensureEcosystemConfig,
  startOrRestart,
  showLogs
};
