#!/usr/bin/env node

const { Command } = require('commander');
const inquirer = require('inquirer');
const { showWelcome, logger } = require('./core/logger');
const { runFrontDeploy } = require('./commands/front');
const { runBackDeploy } = require('./commands/back');
const { runFullstackDeploy } = require('./commands/fullstack');
const { runStatus } = require('./commands/status');
const { runUpdate } = require('./commands/update');
const { runRepair } = require('./commands/repair');
const { runLogs } = require('./commands/logs');
const { runDoctor } = require('./commands/doctor');
const { runPreflight } = require('./commands/preflight');
const { runImport } = require('./commands/import');

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

program
  .command('status [appName]')
  .description('Ver estado de una app desplegada')
  .action((appName) => runStatus(appName));

program
  .command('update [appName]')
  .description('Actualizar una app desplegada desde GitHub')
  .option('--dry-run', 'show what would be executed without changing the server')
  .action((appName, options) => runUpdate(appName, { dryRun: Boolean(options.dryRun || program.opts().dryRun) }));

program
  .command('repair [appName]')
  .description('Reparar configuracion PM2/Nginx de una app')
  .option('--dry-run', 'show what would be executed without changing the server')
  .action((appName, options) => runRepair(appName, { dryRun: Boolean(options.dryRun || program.opts().dryRun) }));

program
  .command('logs [appName]')
  .description('Mostrar estado y logs PM2 de una app')
  .action((appName) => runLogs(appName));

program
  .command('doctor [appName]')
  .description('Revisar entorno general VPS y opcionalmente una app')
  .action((appName) => runDoctor(appName));

program
  .command('preflight [appName]')
  .description('Revisar si una app esta lista para desplegarse o actualizarse')
  .action((appName) => runPreflight(appName));

program
  .command('import')
  .description('Importar o registrar una app existente')
  .option('--dry-run', 'show what would be executed without changing the server')
  .action((options) => runImport({ dryRun: Boolean(options.dryRun || program.opts().dryRun) }));

async function main() {
  if (process.argv.length > 2) {
    await program.parseAsync(process.argv);
    return;
  }

  showWelcome();

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Que quieres hacer?',
      choices: [
        { name: 'Nuevo despliegue', value: 'new' },
        { name: 'Actualizar app existente', value: 'update' },
        { name: 'Reparar app existente', value: 'repair' },
        { name: 'Ver estado de una app', value: 'status' },
        { name: 'Ver logs', value: 'logs' },
        { name: 'Importar/registrar app existente', value: 'import' },
        { name: 'Doctor / revisar VPS', value: 'doctor' },
        { name: 'Salir', value: 'exit' }
      ]
    }
  ]);

  if (answer.action === 'exit') {
    logger.info('Hasta luego.');
    return;
  }

  const dryRun = Boolean(program.opts().dryRun);
  if (answer.action === 'new') {
    const { type } = await inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: 'Que tipo de app quieres desplegar?',
        choices: [
          { name: 'Frontend', value: 'front' },
          { name: 'Backend', value: 'back' },
          { name: 'Fullstack', value: 'fullstack' }
        ]
      }
    ]);
    if (type === 'front') await runFrontDeploy({ dryRun });
    if (type === 'back') await runBackDeploy({ dryRun });
    if (type === 'fullstack') await runFullstackDeploy({ dryRun });
  }
  if (answer.action === 'update') await runUpdate(undefined, { dryRun });
  if (answer.action === 'repair') await runRepair(undefined, { dryRun });
  if (answer.action === 'status') await runStatus();
  if (answer.action === 'logs') await runLogs();
  if (answer.action === 'import') await runImport({ dryRun });
  if (answer.action === 'doctor') await runDoctor();
}

main().catch((error) => {
  logger.error(error.message || String(error));
  process.exit(1);
});
