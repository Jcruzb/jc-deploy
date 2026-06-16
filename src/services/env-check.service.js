const fs = require('fs-extra');
const path = require('path');

function parseEnv(content) {
  const empty = [];
  for (const rawLine of String(content || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    if (value === '' || value === '""' || value === "''") empty.push(match[1]);
  }
  return { empty };
}

async function inspectEnvFile(projectPath, envFile = '.env') {
  const target = path.join(projectPath, envFile);
  if (!(await fs.pathExists(target))) return { exists: false, empty: [] };
  const parsed = parseEnv(await fs.readFile(target, 'utf8'));
  return { exists: true, ...parsed };
}

module.exports = {
  parseEnv,
  inspectEnvFile
};
