const { domainList } = require('./nginx.service');
const inquirer = require('inquirer');
const { warnIfDnsMismatch } = require('./dns.service');

async function runCertbot(runner, domain, includeWww) {
  if (runner.dryRun) {
    const args = ['--nginx'];
    for (const item of domainList(domain, includeWww)) args.push('-d', item);
    runner.sudo('certbot', args, { display: `sudo certbot ${args.join(' ')}` });
    return;
  }
  if (await certificateExists(runner, domain)) return;
  const dnsOk = await warnIfDnsMismatch(runner, domain);
  if (!dnsOk) {
    const { proceed } = await inquirer.prompt([
      { type: 'confirm', name: 'proceed', message: 'El DNS no parece apuntar correctamente. Ejecutar Certbot igualmente?', default: false }
    ]);
    if (!proceed) return;
  }
  const args = ['--nginx'];
  for (const item of domainList(domain, includeWww)) {
    args.push('-d', item);
  }
  await runner.sudo('certbot', args, {
    message: 'Activando SSL con Certbot',
    success: 'SSL configurado'
  });
}

async function certificateExists(runner, domain) {
  try {
    const result = await runner.sudo('certbot', ['certificates'], {
      spinner: false,
      display: 'sudo certbot certificates'
    });
    if (result.stdout.includes(domain)) return true;
  } catch (_) {}
  return false;
}

module.exports = {
  runCertbot,
  certificateExists
};
