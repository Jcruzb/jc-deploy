const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const { logger } = require('../core/logger');
const { parseGithubRepo, suggestedSshUrl } = require('../core/validators');

const GIT_CLONE_TIMEOUT = 60000;

function analysisDirFor(appName) {
  return path.join(os.tmpdir(), 'jc-deploy-check', appName);
}

async function cloneForAnalysis(runner, repoUrl, appName) {
  const target = analysisDirFor(appName);
  if (await fs.pathExists(target)) {
    const { removeExisting } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'removeExisting',
        message: `La carpeta temporal ${target} ya existe. Quieres borrarla antes de analizar la repo?`,
        default: true
      }
    ]);
    if (!removeExisting) throw new Error('Analisis cancelado: la carpeta temporal ya existe.');
    await fs.remove(target);
  }
  await fs.ensureDir(path.dirname(target));
  await runGitClone(runner, ['clone', '--depth', '1', repoUrl, target], repoUrl, {
    message: 'Clonando repo para analisis',
    success: 'Repo analizada',
    timeout: GIT_CLONE_TIMEOUT
  });
  return target;
}

async function ensureProjectRepo(runner, repoUrl, projectDir) {
  if (runner.dryRun) {
    logger.command(`git clone ${repoUrl} ${projectDir}`);
    logger.warn('dry-run: clone/pull omitido');
    return;
  }

  if (!(await fs.pathExists(projectDir))) {
    await fs.ensureDir(path.dirname(projectDir));
    await runGitClone(runner, ['clone', repoUrl, projectDir], repoUrl, {
      message: 'Clonando repo en carpeta definitiva',
      success: 'Repo clonada',
      timeout: GIT_CLONE_TIMEOUT
    });
    return;
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `La carpeta ${projectDir} ya existe. Que quieres hacer?`,
      choices: [
        { name: 'Hacer git pull', value: 'pull' },
        { name: 'Usar carpeta existente sin actualizar', value: 'use' },
        { name: 'Cancelar despliegue', value: 'cancel' }
      ]
    }
  ]);

  if (action === 'cancel') throw new Error('Despliegue cancelado por el usuario.');
  if (action === 'pull') {
    await runner.run('git', ['pull', '--ff-only'], {
      cwd: projectDir,
      message: 'Actualizando repo',
      success: 'Repo actualizado'
    });
  } else {
    logger.warn('Usando carpeta existente sin actualizar.');
  }
}

async function runGitClone(runner, args, repoUrl, options) {
  try {
    return await runner.run('git', args, options);
  } catch (error) {
    const parsed = parseGithubRepo(repoUrl);
    if (parsed && parsed.protocol === 'https' && looksLikeAuthError(error.message)) {
      const sshUrl = suggestedSshUrl(repoUrl);
      throw new Error(`${error.message}\n\nEl clone por HTTPS parece haber fallado por autenticacion. Prueba usando SSH:\n${sshUrl}`);
    }
    throw error;
  }
}

function looksLikeAuthError(message) {
  return /authentication failed|could not read username|permission denied|repository not found|access denied|terminal prompts disabled|support for password authentication/i.test(message);
}

module.exports = {
  analysisDirFor,
  GIT_CLONE_TIMEOUT,
  cloneForAnalysis,
  ensureProjectRepo
};
