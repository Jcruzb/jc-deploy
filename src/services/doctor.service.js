const { logger } = require('../core/logger');
const { commandExists, ensurePm2 } = require('./preflight.service');
const { warnIfRoot } = require('./sudo.service');

const REQUIRED_BINARIES = ['git', 'node', 'npm', 'pm2', 'nginx', 'systemctl', 'certbot', 'ssh', 'sudo', 'rsync'];

async function runDoctorChecks(runner) {
  await warnIfRoot();
  logger.title('Doctor VPS');
  const missing = new Set();
  for (const binary of REQUIRED_BINARIES) {
    const exists = await commandExists(runner, binary);
    if (!exists) {
      missing.add(binary);
      console.log(`${binary === 'pm2' ? 'x' : '!'} ${binary} no encontrado`);
      continue;
    }
    const version = await binaryVersion(runner, binary);
    console.log(`ok ${binary} encontrado${version ? ` (${version})` : ''}`);
  }

  await printCommand(runner, 'whoami', []);
  await printCommand(runner, 'id', []);
  await printCommand(runner, 'node', ['-v']);
  await printCommand(runner, 'npm', ['-v']);
  await printCommand(runner, 'pm2', ['status']);
  if (missing.has('pm2')) await ensurePm2(runner);
  await runner.sudo('nginx', ['-t'], { spinner: false, display: 'sudo nginx -t' }).catch((error) => {
    logger.warn(error.message);
  });
  logger.warn('Si falta Certbot en Debian/Ubuntu: sudo apt install certbot python3-certbot-nginx -y');
}

async function binaryVersion(runner, binary) {
  const args = binary === 'node' || binary === 'npm' ? ['-v'] : ['--version'];
  try {
    const result = await runner.run(binary, args, { spinner: false, display: `${binary} ${args.join(' ')}` });
    return result.stdout.split('\n')[0].trim();
  } catch (_) {
    return '';
  }
}

async function printCommand(runner, command, args) {
  try {
    const result = await runner.run(command, args, { spinner: false, display: [command, ...args].join(' ') });
    if (result.stdout) console.log(result.stdout.trim());
  } catch (error) {
    logger.warn(error.message);
  }
}

module.exports = {
  REQUIRED_BINARIES,
  runDoctorChecks
};
