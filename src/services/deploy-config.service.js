const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { inspectEnvFile } = require('./env-check.service');

const CONFIG_FILE = '.jc-deploy.json';
const SCHEMA_VERSION = 1;

function globalDir() {
  if (process.env.JC_DEPLOY_HOME) return process.env.JC_DEPLOY_HOME;
  return path.join(os.homedir(), '.jc-deploy');
}

function globalIndexPath() {
  return path.join(globalDir(), 'apps.json');
}

function configPath(projectPath) {
  return path.join(projectPath, CONFIG_FILE);
}

async function readDeployConfig(projectPath) {
  const target = configPath(projectPath);
  if (!(await fs.pathExists(target))) return null;
  return fs.readJson(target);
}

async function writeDeployConfig(projectPath, nextConfig) {
  const target = configPath(projectPath);
  const current = await readDeployConfig(projectPath);
  const now = new Date().toISOString();
  const env = nextConfig.env || await safeEnvState(projectPath);
  const config = {
    schemaVersion: SCHEMA_VERSION,
    ...current,
    ...sanitizeConfig(nextConfig),
    projectPath,
    env,
    ecosystemFile: 'ecosystem.config.cjs',
    createdAt: current && current.createdAt ? current.createdAt : now,
    updatedAt: now
  };
  await fs.writeJson(target, config, { spaces: 2 });
  await updateGlobalIndex(config);
  return config;
}

async function readGlobalIndex() {
  const target = globalIndexPath();
  if (!(await fs.pathExists(target))) return { schemaVersion: SCHEMA_VERSION, apps: [] };
  const index = await fs.readJson(target);
  return {
    schemaVersion: index.schemaVersion || SCHEMA_VERSION,
    apps: Array.isArray(index.apps) ? index.apps : []
  };
}

async function writeGlobalIndex(index) {
  await fs.ensureDir(globalDir());
  await fs.writeJson(globalIndexPath(), {
    schemaVersion: SCHEMA_VERSION,
    apps: index.apps || []
  }, { spaces: 2 });
}

async function updateGlobalIndex(config) {
  const index = await readGlobalIndex();
  const entry = indexEntryFromConfig(config);
  const existingIndex = index.apps.findIndex((app) => {
    if (app.projectPath && entry.projectPath) return app.projectPath === entry.projectPath;
    return app.appName === entry.appName;
  });
  if (existingIndex >= 0) index.apps[existingIndex] = { ...index.apps[existingIndex], ...entry };
  else index.apps.push(entry);
  await writeGlobalIndex(index);
}

async function markMissingApps() {
  const index = await readGlobalIndex();
  let changed = false;
  for (const app of index.apps) {
    if (app.projectPath && !(await fs.pathExists(app.projectPath)) && app.status !== 'missing') {
      app.status = 'missing';
      app.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await writeGlobalIndex(index);
  return index;
}

function indexEntryFromConfig(config) {
  return {
    appName: config.appName,
    type: config.type,
    projectPath: config.projectPath,
    domain: config.domain,
    pm2Name: config.pm2Name,
    status: config.status,
    metadataPath: configPath(config.projectPath),
    updatedAt: config.updatedAt || new Date().toISOString()
  };
}

function sanitizeConfig(config) {
  const blocked = /token|secret|password|api[_-]?key|key/i;
  const clean = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (blocked.test(key) && typeof value === 'string') continue;
    clean[key] = value;
  }
  return clean;
}

async function safeEnvState(projectPath) {
  const env = await inspectEnvFile(projectPath).catch(() => ({ exists: false, empty: [] }));
  const exampleExists = await fs.pathExists(path.join(projectPath, '.env.example')).catch(() => false);
  return {
    exists: Boolean(env.exists),
    exampleExists,
    complete: Boolean(env.exists && env.empty.length === 0),
    missingKeys: env.empty || []
  };
}

module.exports = {
  CONFIG_FILE,
  SCHEMA_VERSION,
  configPath,
  globalDir,
  globalIndexPath,
  readDeployConfig,
  writeDeployConfig,
  readGlobalIndex,
  writeGlobalIndex,
  updateGlobalIndex,
  markMissingApps,
  indexEntryFromConfig,
  sanitizeConfig
};
