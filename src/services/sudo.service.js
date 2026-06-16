const inquirer = require('inquirer');
const { logger } = require('../core/logger');

let keepAliveTimer = null;

async function warnIfRoot() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  logger.warn('Estas ejecutando deploy-app como root. Esto puede crear archivos con permisos incorrectos y procesos PM2 bajo root.');
  logger.warn('Cancela y ejecuta como usuario normal. El CLI pedira sudo solo cuando sea necesario.');
  const { continueAsRoot } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continueAsRoot',
      message: 'Confirmas explicitamente que quieres continuar como root?',
      default: false
    }
  ]);
  if (!continueAsRoot) throw new Error('Operacion cancelada. Ejecuta deploy-app como usuario normal.');
}

async function ensureSudo(runner) {
  await warnIfRoot();
  try {
    await runner.sudo('-v', [], {
      spinner: false,
      display: 'sudo -v'
    });
  } catch (error) {
    throw new Error(`No se pudo validar sudo.\n${error.message}`);
  }
}

function keepAlive(runner) {
  if (runner.dryRun || keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    runner.sudo('-n', ['true'], {
      spinner: false,
      display: 'sudo -n true'
    }).catch(() => {});
  }, 60000);
}

function stopKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

module.exports = {
  warnIfRoot,
  ensureSudo,
  keepAlive,
  stopKeepAlive
};
