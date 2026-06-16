const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const { logger } = require('../core/logger');

function analysisDirFor(appName) {
  return path.join(os.tmpdir(), 'jc-deploy-check', appName);
}

async function cloneForAnalysis(runner, repoUrl, appName) {
  const target = analysisDirFor(appName);
  await fs.remove(target);
  await fs.ensureDir(path.dirname(target));
  await runner.run('git', ['clone', '--depth', '1', repoUrl, target], {
    message: 'Clonando repo para analisis',
    success: 'Repo analizada'
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
    await runner.run('git', ['clone', repoUrl, projectDir], {
      message: 'Clonando repo en carpeta definitiva',
      success: 'Repo clonada'
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

module.exports = {
  analysisDirFor,
  cloneForAnalysis,
  ensureProjectRepo
};
