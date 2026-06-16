const inquirer = require('inquirer');
const { logger } = require('../core/logger');
const { writeDeployConfig } = require('./deploy-config.service');
const { showLogs } = require('./pm2.service');

function canRestartWithPm2(config) {
  return Boolean(config && config.pm2Name);
}

function restartMetadataPatch(status = 'restarted') {
  const now = new Date().toISOString();
  return {
    lastRestartAt: now,
    updatedAt: now,
    status
  };
}

async function restartApp(runner, app, { dryRun = false } = {}) {
  const config = app.config || {};
  if (!canRestartWithPm2(config)) {
    logger.warn('Esta app no tiene pm2Name en metadata. No se puede reiniciar con PM2.');
    return false;
  }

  await runner.run('pm2', ['restart', config.pm2Name, '--update-env'], {
    message: `Reiniciando ${config.pm2Name} con PM2`,
    success: 'PM2 reiniciado'
  });
  await runner.run('pm2', ['save'], {
    message: 'Guardando estado PM2',
    success: 'PM2 guardado'
  });

  const { validateNginx } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'validateNginx',
      message: 'Quieres validar Nginx con sudo nginx -t?',
      default: false
    }
  ]);
  if (validateNginx) {
    await runner.sudo('nginx', ['-t'], {
      message: 'Validando Nginx',
      success: 'Nginx valido'
    });
  }

  const { reloadNginx } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'reloadNginx',
      message: 'Modificaste configuracion Nginx y quieres recargarlo?',
      default: false
    }
  ]);
  if (reloadNginx) {
    await runner.sudo('nginx', ['-t'], {
      message: 'Validando Nginx antes de reload',
      success: 'Nginx valido'
    });
    await runner.sudo('systemctl', ['reload', 'nginx'], {
      message: 'Recargando Nginx',
      success: 'Nginx recargado'
    });
  }

  await showLogs(runner, config.pm2Name, 80);
  if (!dryRun) {
    await writeDeployConfig(app.projectPath, {
      ...config,
      ...restartMetadataPatch('restarted')
    });
  }
  return true;
}

module.exports = {
  canRestartWithPm2,
  restartMetadataPatch,
  restartApp
};
