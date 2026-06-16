const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const { logger } = require('../core/logger');
const { isGithubSshUrl, isGithubHttpsUrl, suggestedSshUrl } = require('../core/validators');

const GIT_REMOTE_TIMEOUT = 60000;

async function maybeConvertHttpsToSsh(repoUrl) {
  if (!isGithubHttpsUrl(repoUrl)) return repoUrl;
  const sshUrl = suggestedSshUrl(repoUrl);
  logger.warn('Para repos privadas se recomienda SSH.');
  const { convert } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'convert',
      message: `Convertir a SSH? ${repoUrl} -> ${sshUrl}`,
      default: false
    }
  ]);
  return convert ? sshUrl : repoUrl;
}

async function ensureGithubKnownHost(runner) {
  const sshDir = path.join(os.homedir(), '.ssh');
  const knownHosts = path.join(sshDir, 'known_hosts');
  const content = await fs.readFile(knownHosts, 'utf8').catch(() => '');
  if (content.includes('github.com')) return;
  if (runner.dryRun) {
    logger.command('ssh-keyscan github.com >> ~/.ssh/known_hosts');
    logger.warn('dry-run: known_hosts no fue modificado');
    return;
  }
  await fs.ensureDir(sshDir);
  const result = await runner.run('ssh-keyscan', ['github.com'], {
    spinner: false,
    display: 'ssh-keyscan github.com',
    timeout: 15000
  });
  await fs.appendFile(knownHosts, result.stdout);
}

async function validateGithubSsh(runner, repoUrl) {
  if (!isGithubSshUrl(repoUrl)) return;
  await ensureGithubKnownHost(runner);
  try {
    await runner.run('ssh', ['-T', 'git@github.com'], {
      spinner: false,
      display: 'ssh -T git@github.com',
      timeout: 15000
    });
  } catch (error) {
    if (!/successfully authenticated/i.test(error.message)) {
      logger.warn('No se pudo autenticar con GitHub por SSH.');
      logger.warn('Revisa que la clave publica de esta VPS este agregada en GitHub.');
      logger.warn('Prueba manual: ssh -T git@github.com');
    }
  }
}

async function validateRemoteExists(runner, repoUrl) {
  await runner.run('git', ['ls-remote', repoUrl], {
    spinner: false,
    display: `git ls-remote ${repoUrl}`,
    timeout: GIT_REMOTE_TIMEOUT
  });
}

async function preflightRepoAccess(runner, repoUrl) {
  const nextUrl = await maybeConvertHttpsToSsh(repoUrl);
  await validateGithubSsh(runner, nextUrl);
  await validateRemoteExists(runner, nextUrl);
  return nextUrl;
}

module.exports = {
  GIT_REMOTE_TIMEOUT,
  maybeConvertHttpsToSsh,
  ensureGithubKnownHost,
  validateGithubSsh,
  validateRemoteExists,
  preflightRepoAccess
};
