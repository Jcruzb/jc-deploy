const chalk = require('chalk');
const boxen = require('boxen');

const logger = {
  title(message) {
    console.log(chalk.cyan.bold(`\n${message}`));
  },
  info(message) {
    console.log(chalk.blue('info'), message);
  },
  success(message) {
    console.log(chalk.green('ok'), message);
  },
  warn(message) {
    console.log(chalk.yellow('warn'), message);
  },
  error(message) {
    console.error(chalk.red('error'), message);
  },
  command(command) {
    console.log(chalk.gray(`$ ${command}`));
  }
};

function showWelcome() {
  console.log(
    boxen('JC Deploy Assistant\nVPS + Node.js + Nginx + PM2 Deploy', {
      padding: 1,
      margin: 1,
      borderColor: 'cyan',
      align: 'center'
    })
  );
}

function showModes() {
  console.log(chalk.bold('Modos disponibles:'));
  console.log(`${chalk.cyan('deploy-app front')}      Desplegar frontend estatico React/Vite`);
  console.log(`${chalk.cyan('deploy-app back')}       Desplegar backend Node.js con PM2`);
  console.log(`${chalk.cyan('deploy-app fullstack')}  Desplegar frontend + backend`);
  console.log('');
}

function printSummary(title, entries) {
  logger.title(title);
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === '') continue;
    console.log(`${chalk.bold(key)}: ${value}`);
  }
}

module.exports = {
  logger,
  showWelcome,
  showModes,
  printSummary
};
