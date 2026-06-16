const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const { readDeployConfig, readGlobalIndex, markMissingApps } = require('./deploy-config.service');

function appsRoot() {
  return path.join('/home', os.userInfo().username, 'apps');
}

async function listDetectedApps(root = appsRoot()) {
  await markMissingApps();
  const byPath = new Map();
  const index = await readGlobalIndex();
  for (const entry of index.apps) {
    if (!entry.projectPath) continue;
    byPath.set(entry.projectPath, {
      appName: entry.appName || path.basename(entry.projectPath),
      projectPath: entry.projectPath,
      config: await readDeployConfig(entry.projectPath),
      source: 'index',
      status: entry.status
    });
  }

  if (await fs.pathExists(root)) {
    const entries = await fs.readdir(root);
    for (const entry of entries) {
      const projectPath = path.join(root, entry);
      const stat = await fs.stat(projectPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const config = await readDeployConfig(projectPath);
      const hasPackage = await fs.pathExists(path.join(projectPath, 'package.json'));
      const hasGit = await fs.pathExists(path.join(projectPath, '.git'));
      if (config || hasPackage || hasGit) {
        byPath.set(projectPath, {
          ...(byPath.get(projectPath) || {}),
          appName: config && config.appName ? config.appName : entry,
          projectPath,
          config,
          source: config ? 'metadata' : 'detected'
        });
      }
    }
  }

  return Array.from(byPath.values()).sort((a, b) => a.appName.localeCompare(b.appName));
}

async function resolveApp(appName) {
  const apps = await listDetectedApps();
  if (appName) {
    const byName = apps.find((app) => app.appName === appName || path.basename(app.projectPath) === appName);
    if (byName) return byName;
    const fallbackPath = path.join(appsRoot(), appName);
    return { appName, projectPath: fallbackPath, config: await readDeployConfig(fallbackPath) };
  }

  if (!apps.length) throw new Error(`No se detectaron apps en ${appsRoot()}.`);
  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: 'Selecciona una app:',
      choices: apps.map((app) => ({
        name: `${app.appName} (${app.projectPath})`,
        value: app.projectPath
      }))
    }
  ]);
  return apps.find((app) => app.projectPath === selected);
}

module.exports = {
  appsRoot,
  listDetectedApps,
  resolveApp
};
