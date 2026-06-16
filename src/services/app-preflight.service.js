const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../core/logger');
const { inspectProject, printProjectState } = require('./state.service');
const { inspectEnvFile } = require('./env-check.service');
const { commandExists } = require('./preflight.service');

const PORT_FILES = [
  'server.js', 'server.ts', 'app.js', 'app.ts', 'index.js', 'index.ts',
  'src/server.js', 'src/server.ts', 'src/app.js', 'src/app.ts'
];

async function runAppPreflight(runner, app) {
  const config = app.config || { appName: app.appName, projectPath: app.projectPath };
  const state = await inspectProject(runner, { ...config, projectPath: app.projectPath });
  printProjectState(state);

  if (state.packageJson && state.scripts) {
    if (state.hasBuildScript) logger.info('Script build detectado.');
    if (!state.hasStartScript && !state.hasProdScript) logger.warn('No se detecto script start/prod.');
  }

  await checkPackageManagerBinary(runner, config);
  await checkNvmrc(app.projectPath);
  await checkEnv(app.projectPath);
  await checkHardcodedPorts(app.projectPath);
  return state;
}

async function checkPackageManagerBinary(runner, config) {
  const install = String(config.installCommand || '');
  const binary = install.startsWith('pnpm') ? 'pnpm' : install.startsWith('yarn') ? 'yarn' : null;
  if (binary && !(await commandExists(runner, binary))) {
    logger.warn(`Se detecto ${binary} en el comando de instalacion, pero el binario no existe.`);
  }
}

async function checkNvmrc(projectPath) {
  const nvmrc = path.join(projectPath, '.nvmrc');
  if (!(await fs.pathExists(nvmrc))) return;
  const expected = (await fs.readFile(nvmrc, 'utf8')).trim();
  logger.info(`.nvmrc detectado: ${expected}. Compara con node -v antes de desplegar.`);
}

async function checkEnv(projectPath) {
  const env = await inspectEnvFile(projectPath);
  if (!env.exists) return;
  if (env.empty.length) {
    logger.warn('Variables pendientes de completar:');
    for (const key of env.empty) console.log(`- ${key}`);
  }
}

async function checkHardcodedPorts(projectPath) {
  const findings = [];
  for (const relative of PORT_FILES) {
    const target = path.join(projectPath, relative);
    if (!(await fs.pathExists(target))) continue;
    const content = await fs.readFile(target, 'utf8');
    if (/(const|let)\s+PORT\s*=\s*\d+|(?:app|server)\.listen\(\s*\d+/.test(content)) {
      findings.push(relative);
    }
  }
  if (!findings.length) return;
  logger.warn('Parece que el puerto esta hardcodeado. Se recomienda usar process.env.PORT.');
  for (const file of findings) console.log(`- ${file}`);
}

module.exports = {
  PORT_FILES,
  runAppPreflight
};
