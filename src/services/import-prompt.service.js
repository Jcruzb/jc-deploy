const inquirer = require('inquirer');
const { runImportFlow } = require('./import.service');

async function offerImportIfMissingMetadata(runner, app, { dryRun = false } = {}) {
  if (app.config) return false;
  const { importFirst } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'importFirst',
      message: 'Esta app no tiene metadata de jc-deploy. Quieres importarla primero?',
      default: true
    }
  ]);
  if (!importFirst) return null;
  return runImportFlow(runner, { dryRun });
}

module.exports = {
  offerImportIfMissingMetadata
};
