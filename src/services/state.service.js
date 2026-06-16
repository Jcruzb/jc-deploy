const fs = require('fs-extra');
const path = require('path');
const { readPackageJson } = require('./package.service');
const { readDeployConfig } = require('./deploy-config.service');
const { ecosystemPath } = require('./pm2.service');
const { siteAvailablePath, siteEnabledPath } = require('./nginx.service');

async function inspectProject(runner, input) {
  const projectPath = input.projectPath;
  const config = (await readDeployConfig(projectPath)) || {};
  const appName = input.appName || config.appName || path.basename(projectPath);
  const domain = input.domain || config.domain;
  const pm2Name = input.pm2Name || config.pm2Name || appName;
  const state = {
    appName,
    type: input.type || config.type || 'unknown',
    projectPath,
    domain,
    port: input.port || config.port,
    pm2Name,
    repoUrl: input.repoUrl || config.repoUrl,
    installCommand: input.installCommand || config.installCommand,
    buildCommand: input.buildCommand || config.buildCommand,
    startCommand: input.startCommand || config.startCommand,
    ecosystemFile: config.ecosystemFile || 'ecosystem.config.cjs',
    exists: await fs.pathExists(projectPath)
  };

  state.isGitRepo = state.exists && (await fs.pathExists(path.join(projectPath, '.git')));
  state.packageJson = state.exists && (await fs.pathExists(path.join(projectPath, 'package.json')));
  state.nodeModules = state.exists && (await fs.pathExists(path.join(projectPath, 'node_modules')));
  state.dist = state.exists && (await fs.pathExists(path.join(projectPath, 'dist')));
  state.env = state.exists && (await fs.pathExists(path.join(projectPath, '.env')));
  state.envExample = state.exists && (await fs.pathExists(path.join(projectPath, '.env.example')));
  state.ecosystemCjs = state.exists && (await fs.pathExists(ecosystemPath(projectPath)));
  state.ecosystemJs = state.exists && (await fs.pathExists(path.join(projectPath, 'ecosystem.config.js')));
  state.nginxConfig = await sudoTestFile(runner, siteAvailablePath(appName));
  state.nginxEnabled = await sudoTestFile(runner, siteEnabledPath(appName));
  state.nginxValid = await nginxTest(runner);
  state.ssl = domain ? await detectCertbotCertificate(runner, domain) : 'desconocido';

  if (state.packageJson) {
    const pkg = await readPackageJson(projectPath);
    state.packageType = pkg.type;
    state.typeModule = pkg.type === 'module';
    state.scripts = pkg.scripts || {};
    state.hasBuildScript = Boolean(state.scripts.build);
    state.hasStartScript = Boolean(state.scripts.start);
    state.hasProdScript = Boolean(state.scripts.prod);
    state.hasDevScript = Boolean(state.scripts.dev);
  } else {
    state.scripts = {};
  }

  if (state.isGitRepo) {
    state.remote = await gitOutput(runner, projectPath, ['remote', 'get-url', 'origin']);
    state.repoUrl = state.repoUrl || state.remote;
    state.branch = await gitOutput(runner, projectPath, ['branch', '--show-current']);
    state.gitStatus = await gitOutput(runner, projectPath, ['status', '--porcelain']);
    state.hasLocalChanges = Boolean(state.gitStatus);
  }

  state.pm2 = await getPm2Process(runner, pm2Name);
  return state;
}

async function gitOutput(runner, cwd, args) {
  try {
    const result = await runner.run('git', args, { cwd, spinner: false, display: `git ${args.join(' ')}` });
    return result.stdout.trim();
  } catch (_) {
    return '';
  }
}

async function getPm2Process(runner, pm2Name) {
  try {
    const result = await runner.run('pm2', ['jlist'], { spinner: false, display: 'pm2 jlist' });
    const processes = JSON.parse(result.stdout || '[]');
    const found = processes.find((item) => item.name === pm2Name);
    if (!found) return { exists: false, status: 'no existe' };
    return {
      exists: true,
      status: found.pm2_env && found.pm2_env.status ? found.pm2_env.status : 'desconocido',
      pid: found.pid
    };
  } catch (_) {
    return { exists: false, status: 'desconocido' };
  }
}

async function sudoTestFile(runner, filePath) {
  try {
    await runner.sudo('test', ['-e', filePath], { spinner: false, display: `sudo test -e ${filePath}` });
    return true;
  } catch (_) {
    return false;
  }
}

async function nginxTest(runner) {
  try {
    await runner.sudo('nginx', ['-t'], { spinner: false, display: 'sudo nginx -t' });
    return true;
  } catch (_) {
    return false;
  }
}

async function detectCertbotCertificate(runner, domain) {
  try {
    const result = await runner.sudo('certbot', ['certificates'], {
      spinner: false,
      display: 'sudo certbot certificates'
    });
    return result.stdout.includes(domain) ? 'si' : 'no';
  } catch (_) {
    return 'desconocido';
  }
}

function printProjectState(state) {
  const rows = [
    ['Proyecto', state.projectPath],
    ['Tipo', state.type],
    ['Repo', state.repoUrl || state.remote || 'desconocido'],
    ['Rama', state.branch || 'desconocido'],
    ['Cambios locales', state.hasLocalChanges ? 'si' : 'no'],
    ['Package', state.packageJson ? 'encontrado' : 'no'],
    ['type: module', state.typeModule ? 'si' : 'no'],
    ['Scripts', scriptSummary(state)],
    ['node_modules', state.nodeModules ? 'si' : 'no'],
    ['dist', state.dist ? 'si' : 'no'],
    ['.env', state.env ? 'si' : 'no'],
    ['.env.example', state.envExample ? 'si' : 'no'],
    ['ecosystem.config.cjs', state.ecosystemCjs ? 'si' : 'no'],
    ['ecosystem.config.js', state.ecosystemJs ? 'si' : 'no'],
    ['PM2', state.pm2 ? state.pm2.status : 'desconocido'],
    ['Nginx config', state.nginxConfig ? 'si' : 'no'],
    ['Nginx enabled', state.nginxEnabled ? 'si' : 'no'],
    ['Nginx valid', state.nginxValid ? 'si' : 'no'],
    ['SSL', state.ssl],
    ['Puerto', state.port || 'desconocido'],
    ['Dominio', state.domain || 'desconocido']
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`${label.padEnd(width)} : ${value}`);
  }
}

function scriptSummary(state) {
  const scripts = [];
  if (state.hasBuildScript) scripts.push('build');
  if (state.hasStartScript) scripts.push('start');
  if (state.hasProdScript) scripts.push('prod');
  if (state.hasDevScript) scripts.push('dev');
  return scripts.length ? scripts.join(', ') : 'no detectados';
}

module.exports = {
  inspectProject,
  printProjectState
};
