const fs = require('fs-extra');
const path = require('path');

async function readPackageJson(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(packagePath))) {
    throw new Error(`No existe package.json en ${projectDir}. No se puede continuar.`);
  }
  return fs.readJson(packagePath);
}

async function detectScripts(projectDir) {
  const pkg = await readPackageJson(projectDir);
  return pkg.scripts || {};
}

async function detectPackageManager(projectDir) {
  return detectPackageManagerFromFiles({
    pnpmLock: await fs.pathExists(path.join(projectDir, 'pnpm-lock.yaml')),
    yarnLock: await fs.pathExists(path.join(projectDir, 'yarn.lock')),
    packageLock: await fs.pathExists(path.join(projectDir, 'package-lock.json'))
  });
}

function detectPackageManagerFromFiles(files) {
  if (files.pnpmLock) return 'pnpm';
  if (files.yarnLock) return 'yarn';
  if (files.packageLock) return 'npm-ci';
  return 'npm';
}

function installCommandFor(manager) {
  if (manager === 'pnpm') return 'pnpm install';
  if (manager === 'yarn') return 'yarn install';
  if (manager === 'npm-ci') return 'npm ci';
  return 'npm install';
}

function buildCommandFor(scripts) {
  return scripts.build ? 'npm run build' : '';
}

function startCommandFor(scripts) {
  if (scripts.start) return 'npm start';
  if (scripts.prod) return 'npm run prod';
  if (scripts.production) return 'npm run production';
  return '';
}

function splitCommand(command) {
  return String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function validateInstallCommand(command, projectFiles = {}) {
  const normalized = String(command || '').trim();
  if (normalized === 'npm ci' && !projectFiles.packageLock) {
    return 'Elegiste npm ci pero no existe package-lock.json. Usa npm install o genera el lockfile.';
  }
  if (normalized.startsWith('yarn') && !projectFiles.yarnLock) {
    return 'Elegiste yarn pero no se detecto yarn.lock.';
  }
  if (normalized.startsWith('pnpm') && !projectFiles.pnpmLock) {
    return 'Elegiste pnpm pero no se detecto pnpm-lock.yaml.';
  }
  return null;
}

async function analyzeNodeProject(projectDir) {
  const scripts = await detectScripts(projectDir);
  const manager = await detectPackageManager(projectDir);
  return {
    scripts,
    scriptNames: Object.keys(scripts),
    packageManager: manager,
    installCommand: installCommandFor(manager),
    buildCommand: buildCommandFor(scripts),
    startCommand: startCommandFor(scripts)
  };
}

module.exports = {
  readPackageJson,
  detectScripts,
  detectPackageManager,
  detectPackageManagerFromFiles,
  installCommandFor,
  buildCommandFor,
  startCommandFor,
  splitCommand,
  validateInstallCommand,
  analyzeNodeProject
};
