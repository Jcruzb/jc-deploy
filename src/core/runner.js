const execa = require('execa');
const ora = require('ora');
const { logger } = require('./logger');

function formatCommand(command, args = []) {
  return [command, ...args].join(' ');
}

class Runner {
  constructor({ dryRun = false } = {}) {
    this.dryRun = dryRun;
  }

  async run(command, args = [], options = {}) {
    const display = options.display || formatCommand(command, args);
    logger.command(display);

    if (this.dryRun) {
      logger.warn('dry-run: comando omitido');
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const spinner = options.spinner === false ? null : ora(options.message || display).start();
    try {
      const result = await execa(command, args, {
        stdio: options.stdio || 'pipe',
        cwd: options.cwd,
        env: options.env,
        shell: false
      });
      if (spinner) spinner.succeed(options.success || 'Completado');
      return result;
    } catch (error) {
      if (spinner) spinner.fail(options.failure || 'Fallo el comando');
      const detail = error.stderr || error.stdout || error.shortMessage || error.message;
      throw new Error(`${display}\n${detail}`);
    }
  }

  async sudo(command, args = [], options = {}) {
    return this.run('sudo', [command, ...args], {
      ...options,
      display: `sudo ${formatCommand(command, args)}`
    });
  }
}

module.exports = {
  Runner,
  formatCommand
};
