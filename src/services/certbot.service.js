const { domainList } = require('./nginx.service');

async function runCertbot(runner, domain, includeWww) {
  const args = ['--nginx'];
  for (const item of domainList(domain, includeWww)) {
    args.push('-d', item);
  }
  await runner.sudo('certbot', args, {
    message: 'Activando SSL con Certbot',
    success: 'SSL configurado'
  });
}

module.exports = {
  runCertbot
};
