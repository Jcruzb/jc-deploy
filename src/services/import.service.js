const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const { appsRoot } = require('./app.service');
const { readDeployConfig, writeDeployConfig, configPath } = require('./deploy-config.service');
const { analyzeNodeProject } = require('./package.service');
const { inspectEnvFile } = require('./env-check.service');
const { logger, printSummary } = require('../core/logger');

async function discoverImportCandidates(runner, root = appsRoot()) {
  const candidates = new Map();
  if (await fs.pathExists(root)) {
    for (const entry of await fs.readdir(root)) {
      const projectPath = path.join(root, entry);
      const stat = await fs.stat(projectPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const hasGit = await fs.pathExists(path.join(projectPath, '.git'));
      const hasPackage = await fs.pathExists(path.join(projectPath, 'package.json'));
      const metadata = await readDeployConfig(projectPath);
      if (hasGit || hasPackage || metadata) {
        candidates.set(projectPath, {
          appName: metadata && metadata.appName ? metadata.appName : entry,
          projectPath,
          hasGit,
          hasPackage,
          hasMetadata: Boolean(metadata),
          metadata
        });
      }
    }
  }

  await addPm2Candidates(runner, candidates);
  await addNginxCandidates(runner, candidates);
  await addVarWwwHints(runner, candidates);
  return Array.from(candidates.values()).sort((a, b) => a.appName.localeCompare(b.appName));
}

async function inferAppMetadata(runner, candidate) {
  const projectPath = candidate.projectPath;
  const appName = candidate.appName || path.basename(projectPath);
  const metadata = {
    appName,
    projectPath,
    type: 'back',
    status: 'imported',
    ecosystemFile: 'ecosystem.config.cjs',
    nginxConfig: `/etc/nginx/sites-available/${appName}`
  };

  metadata.repoUrl = await gitOutput(runner, projectPath, ['remote', 'get-url', 'origin']);
  metadata.branch = await gitOutput(runner, projectPath, ['branch', '--show-current']);

  if (candidate.hasPackage) {
    const analysis = await analyzeNodeProject(projectPath);
    metadata.installCommand = analysis.installCommand;
    metadata.buildCommand = analysis.buildCommand || undefined;
    metadata.startCommand = analysis.startCommand || undefined;
    metadata.type = inferType(projectPath, analysis);
  }

  const pm2 = await findPm2ForApp(runner, appName);
  if (pm2) {
    metadata.pm2Name = pm2.name;
    metadata.port = pm2.port || metadata.port;
    metadata.type = metadata.type === 'front' ? 'back' : metadata.type;
  } else {
    metadata.pm2Name = appName;
  }

  const nginx = await inferNginx(runner, appName);
  if (nginx) {
    metadata.domain = nginx.domain;
    metadata.publicPath = nginx.root || null;
    metadata.nginxConfig = nginx.configPath;
    metadata.nginxEnabled = true;
    if (nginx.proxyPort) metadata.port = nginx.proxyPort;
  }

  const env = await inspectEnvFile(projectPath);
  metadata.env = {
    exists: env.exists,
    exampleExists: await fs.pathExists(path.join(projectPath, '.env.example')),
    complete: Boolean(env.exists && env.empty.length === 0),
    missingKeys: env.empty
  };

  return metadata;
}

async function runImportFlow(runner, { dryRun = false } = {}) {
  const candidates = await discoverImportCandidates(runner);
  if (!candidates.length) throw new Error('No se detectaron apps importables.');
  const { projectPath } = await inquirer.prompt([
    {
      type: 'list',
      name: 'projectPath',
      message: 'Selecciona app para registrar:',
      choices: candidates.map((candidate) => ({
        name: `${candidate.appName} | Proyecto: ${candidate.projectPath} | Git: ${candidate.hasGit ? 'si' : 'no'} | package.json: ${candidate.hasPackage ? 'si' : 'no'} | Metadata: ${candidate.hasMetadata ? 'si' : 'no'}`,
        value: candidate.projectPath
      }))
    }
  ]);
  const candidate = candidates.find((item) => item.projectPath === projectPath);
  const inferred = await inferAppMetadata(runner, candidate);
  if (!inferred.type || inferred.type === 'unknown') {
    const { type } = await inquirer.prompt([
      { type: 'list', name: 'type', message: 'Tipo de app:', choices: ['front', 'back', 'fullstack'] }
    ]);
    inferred.type = type;
  }
  if (!inferred.domain) {
    const { domain } = await inquirer.prompt([{ type: 'input', name: 'domain', message: 'Dominio (opcional):' }]);
    inferred.domain = domain || undefined;
  }
  if ((inferred.type === 'back' || inferred.type === 'fullstack') && !inferred.port) {
    const { port } = await inquirer.prompt([{ type: 'input', name: 'port', message: 'Puerto backend:', default: 3000, filter: Number }]);
    inferred.port = port;
  }

  printSummary('Resumen importacion', {
    App: inferred.appName,
    Tipo: inferred.type,
    Proyecto: inferred.projectPath,
    Repo: inferred.repoUrl || 'desconocido',
    Rama: inferred.branch || 'desconocido',
    Dominio: inferred.domain || 'desconocido',
    Puerto: inferred.port || 'desconocido',
    PM2: inferred.pm2Name || 'desconocido',
    Metadata: configPath(inferred.projectPath)
  });

  const { confirm } = await inquirer.prompt([
    { type: 'confirm', name: 'confirm', message: 'Registrar esta app en jc-deploy?', default: true }
  ]);
  if (!confirm) throw new Error('Importacion cancelada.');
  if (dryRun) {
    logger.warn('dry-run: no se creara .jc-deploy.json ni se actualizara el indice global.');
    return inferred;
  }
  await writeDeployConfig(inferred.projectPath, inferred);
  logger.success('App registrada.');
  return inferred;
}

function inferType(projectPath, analysis, hints = {}) {
  const scripts = analysis.scripts || {};
  const depsText = JSON.stringify(scripts).toLowerCase();
  if (hints.hasFrontendDir && hints.hasBackendDir) return 'fullstack';
  if (fs.existsSync(path.join(projectPath, 'frontend')) && fs.existsSync(path.join(projectPath, 'backend'))) return 'fullstack';
  if (/express|fastify|nest|server|api/.test(depsText) || scripts.start || scripts.prod) return 'back';
  if (scripts.build && !scripts.start) return 'front';
  return 'unknown';
}

async function gitOutput(runner, cwd, args) {
  try {
    const result = await runner.run('git', args, { cwd, spinner: false, display: `git ${args.join(' ')}` });
    return result.stdout.trim();
  } catch (_) {
    return '';
  }
}

async function findPm2ForApp(runner, appName) {
  try {
    const result = await runner.run('pm2', ['jlist'], { spinner: false, display: 'pm2 jlist' });
    const processes = JSON.parse(result.stdout || '[]');
    const found = processes.find((item) => item.name === appName || (item.pm2_env && item.pm2_env.pm_cwd && item.pm2_env.pm_cwd.endsWith(appName)));
    if (!found) return null;
    return {
      name: found.name,
      port: found.pm2_env && found.pm2_env.env ? Number(found.pm2_env.env.PORT) || undefined : undefined
    };
  } catch (_) {
    return null;
  }
}

async function inferNginx(runner, appName) {
  const configPathGuess = `/etc/nginx/sites-available/${appName}`;
  try {
    const result = await runner.sudo('cat', [configPathGuess], { spinner: false, display: `sudo cat ${configPathGuess}` });
    return parseNginxConfig(result.stdout, configPathGuess);
  } catch (_) {
    return null;
  }
}

function parseNginxConfig(content, configPathValue) {
  const serverName = String(content).match(/server_name\s+([^;]+);/);
  const root = String(content).match(/root\s+([^;]+);/);
  const proxy = String(content).match(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/);
  return {
    configPath: configPathValue,
    domain: serverName ? serverName[1].trim().split(/\s+/)[0] : undefined,
    root: root ? root[1].trim() : undefined,
    proxyPort: proxy ? Number(proxy[1]) : undefined
  };
}

async function addPm2Candidates(runner, candidates) {
  try {
    const result = await runner.run('pm2', ['jlist'], { spinner: false, display: 'pm2 jlist' });
    for (const item of JSON.parse(result.stdout || '[]')) {
      const cwd = item.pm2_env && item.pm2_env.pm_cwd;
      if (cwd && !candidates.has(cwd)) {
        candidates.set(cwd, { appName: item.name, projectPath: cwd, hasGit: await fs.pathExists(path.join(cwd, '.git')), hasPackage: await fs.pathExists(path.join(cwd, 'package.json')), hasMetadata: false });
      }
    }
  } catch (_) {}
}

async function addNginxCandidates(_runner, _candidates) {}
async function addVarWwwHints(_runner, _candidates) {}

module.exports = {
  discoverImportCandidates,
  inferAppMetadata,
  inferType,
  parseNginxConfig,
  runImportFlow
};
