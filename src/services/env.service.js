const { copyEnvExample, hasEnvExample } = require('./filesystem.service');
const { logger } = require('../core/logger');

async function createEnvFromExample(projectDir, shouldCreate, targetName = '.env') {
  if (!shouldCreate) return false;
  if (!(await hasEnvExample(projectDir))) return false;
  await copyEnvExample(projectDir, targetName);
  logger.warn(`${targetName} creado desde .env.example. Completa los valores reales antes de confiar en el arranque.`);
  return true;
}

module.exports = {
  createEnvFromExample
};
