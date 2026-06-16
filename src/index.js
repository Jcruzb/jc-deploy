#!/usr/bin/env node

const { Command } = require('commander');
const inquirer = require('inquirer');
const { showWelcome, showModes, logger } = require('./core/logger');
const { runFrontDeploy } = require('./commands/front');
const { runBackDeploy } = require('./commands/back');
const { runFullstackDeploy } = require('./commands/fullstack');

const program = new Command();

program
  .name('deploy-app')
  .description('JC Deploy Assistant: VPS + Node.js + Nginx + PM2 deploys')
  .version('1.0.0')
  .option('--dry-run', 'show what would be executed without changing the server');

program
  .command('front')
  .description('Desplegar frontend estatico React/Vite')
  .option('--dry-run', 'show what would be executed without changing the server')
  .action((options) => runFrontDeploy({ dryRun: Boolean(options.dryRun || program.opts().dryRun) }));

program
  .command('back')
  .description('Desplegar backend Node.js con PM2')
  .option('--dry-run', 'show what would be executed without changing the server')
  .action((options) => runBackDeploy({ dryRun: Boolean(options.dryRun || program.opts().dryRun) }));

program
  .command('fullstack')
  .description('Desplegar frontend + backend')
  .option('--dry-run', 'show what would be executed without changing the server')
  .action((options) => runFullstackDeploy({ dryRun: Boolean(options.dryRun || program.opts().dryRun) }));

async function main() {
  if (process.argv.length > 2) {
    await program.parseAsync(process.argv);
    return;
  }

  showWelcome();
  showModes();

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'Quieres iniciar un modo guiado?',
      choices: [
        { name: 'Frontend estatico', value: 'front' },
        { name: 'Backend Node.js', value: 'back' },
        { name: 'Fullstack', value: 'fullstack' },
        { name: 'Salir', value: 'exit' }
      ]
    }
  ]);

  if (answer.mode === 'exit') {
    logger.info('Hasta luego.');
    return;
  }

  const dryRun = Boolean(program.opts().dryRun);
  if (answer.mode === 'front') await runFrontDeploy({ dryRun });
  if (answer.mode === 'back') await runBackDeploy({ dryRun });
  if (answer.mode === 'fullstack') await runFullstackDeploy({ dryRun });
}

main().catch((error) => {
  logger.error(error.message || String(error));
  process.exit(1);
});
