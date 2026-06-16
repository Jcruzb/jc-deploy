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
  if (await fs.pathExists(path.join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fs.pathExists(path.join(projectDir, 'yarn.lock'))) return 'yarn';
  if (await fs.pathExists(path.join(projectDir, 'package-lock.json'))) return 'npm-ci';
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
  installCommandFor,
  buildCommandFor,
  startCommandFor,
  splitCommand,
  analyzeNodeProject
};
