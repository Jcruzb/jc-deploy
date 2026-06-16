const fs = require('fs-extra');
const path = require('path');

async function hasEnvExample(projectDir) {
  return fs.pathExists(path.join(projectDir, '.env.example'));
}

async function hasFile(projectDir, fileName) {
  return fs.pathExists(path.join(projectDir, fileName));
}

async function ensureDirWithSudo(runner, dir) {
  await runner.sudo('mkdir', ['-p', dir], {
    message: `Creando ${dir}`,
    success: 'Carpeta lista'
  });
}

async function copyEnvExample(projectDir, targetName = '.env') {
  await fs.copy(path.join(projectDir, '.env.example'), path.join(projectDir, targetName), {
    overwrite: false,
    errorOnExist: false
  });
}

async function writeFileIfMissing(filePath, content) {
  if (await fs.pathExists(filePath)) return false;
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

async function suggestExistingSubdir(rootDir, candidates) {
  for (const candidate of candidates) {
    if (await fs.pathExists(path.join(rootDir, candidate, 'package.json'))) return candidate;
  }
  return candidates[0];
}

module.exports = {
  hasEnvExample,
  hasFile,
  ensureDirWithSudo,
  copyEnvExample,
  writeFileIfMissing,
  suggestExistingSubdir
};
