const inquirer = require('inquirer');
const os = require('os');
const path = require('path');
const { logger, printSummary } = require('./logger');
const {
  validateGithubUrl,
  repoNameFromUrl,
  sanitizeAppName,
  validateAppName,
  validateAbsolutePath
} = require('./validators');

function showSafetyNotice() {
  logger.warn('Esta herramienta ejecutara comandos en la VPS y puede modificar Nginx, PM2 y /var/www.');
  logger.warn('Esta pensada para repos propias. Antes de cambios importantes mostrara un resumen y pedira confirmacion.');
}

async function askCommonRepoInfo() {
  showSafetyNotice();
  const { repoUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'repoUrl',
      message: 'URL del repo GitHub:',
      validate: validateGithubUrl
    }
  ]);

  const suggestedName = repoNameFromUrl(repoUrl);
  const { appName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'appName',
      message: 'Nombre de app:',
      default: suggestedName,
      filter: sanitizeAppName,
      validate: validateAppName
    }
  ]);

  const currentUser = os.userInfo().username;
  const defaultProjectDir = path.join('/home', currentUser, 'apps', appName);
  const { projectDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectDir',
      message: 'Carpeta definitiva del proyecto:',
      default: defaultProjectDir,
      validate: validateAbsolutePath
    }
  ]);

  return { repoUrl, suggestedName, appName, projectDir, currentUser };
}

async function confirmFinalSummary(title, entries) {
  printSummary(title, entries);
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Ejecutar despliegue con esta configuracion? Esta accion modificara archivos en la VPS.',
      default: false
    }
  ]);
  return confirm;
}

async function askEnvCreation(hasEnvExample, label = '.env') {
  if (!hasEnvExample) return false;
  const { createEnv } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'createEnv',
      message: `He encontrado .env.example. Quieres crear ${label} a partir de este archivo?`,
      default: true
    }
  ]);
  return createEnv;
}

async function askNginxAndSsl(defaultNginx = true) {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureNginx',
      message: 'Configurar Nginx?',
      default: defaultNginx
    },
    {
      type: 'confirm',
      name: 'enableSsl',
      message: 'Activar SSL con Certbot? Antes de activar SSL, asegurate de que el dominio apunta a esta VPS.',
      default: false,
      when: (answersSoFar) => answersSoFar.configureNginx
    }
  ]);
  return {
    configureNginx: answers.configureNginx,
    enableSsl: Boolean(answers.enableSsl)
  };
}

module.exports = {
  showSafetyNotice,
  askCommonRepoInfo,
  confirmFinalSummary,
  askEnvCreation,
  askNginxAndSsl
};
