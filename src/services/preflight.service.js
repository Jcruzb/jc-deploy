const inquirer = require('inquirer');
const { logger } = require('../core/logger');

async function commandExists(runner, command) {
  try {
    await runner.run('which', [command], {
      spinner: false,
      display: `which ${command}`
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureCommands(runner, commands) {
  for (const command of commands) {
    const exists = await commandExists(runner, command);
    if (!exists) throw new Error(`Falta el comando requerido: ${command}`);
  }
}

async function ensurePm2(runner) {
  if (await commandExists(runner, 'pm2')) return;
  const { install } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'install',
      message: 'PM2 no esta instalado. Quieres instalarlo globalmente con npm install pm2 -g?',
      default: false
    }
  ]);
  if (!install) throw new Error('PM2 es requerido para desplegar backend.');
  await runner.run('npm', ['install', 'pm2', '-g'], {
    message: 'Instalando PM2 globalmente',
    success: 'PM2 instalado'
  });
}

async function ensureCertbotIfNeeded(runner, enableSsl) {
  if (!enableSsl) return;
  if (await commandExists(runner, 'certbot')) return;
  logger.warn('Certbot no esta instalado. Instala certbot y python3-certbot-nginx, o vuelve a ejecutar sin SSL.');
  throw new Error('Certbot es requerido porque pediste SSL.');
}

module.exports = {
  commandExists,
  ensureCommands,
  ensurePm2,
  ensureCertbotIfNeeded
};
