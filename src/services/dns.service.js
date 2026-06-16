const { logger } = require('../core/logger');

async function resolveDomain(runner, domain) {
  const methods = [
    ['dig', ['+short', domain]],
    ['getent', ['hosts', domain]],
    ['nslookup', [domain]]
  ];
  for (const [command, args] of methods) {
    try {
      const result = await runner.run(command, args, {
        spinner: false,
        display: `${command} ${args.join(' ')}`,
        timeout: 15000
      });
      const ips = extractIps(result.stdout);
      if (ips.length) return ips;
    } catch (_) {}
  }
  return [];
}

async function publicIpv4(runner) {
  try {
    const result = await runner.run('curl', ['-4', 'ifconfig.me'], {
      spinner: false,
      display: 'curl -4 ifconfig.me',
      timeout: 15000
    });
    return result.stdout.trim();
  } catch (_) {
    return '';
  }
}

async function warnIfDnsMismatch(runner, domain) {
  const ips = await resolveDomain(runner, domain);
  if (!ips.length) {
    logger.warn(`El dominio ${domain} no resuelve. Certbot puede fallar.`);
    return false;
  }
  const publicIp = await publicIpv4(runner);
  if (publicIp && !ips.includes(publicIp)) {
    logger.warn(`El dominio ${domain} resuelve a ${ips.join(', ')}, pero la VPS parece ser ${publicIp}.`);
    return false;
  }
  return true;
}

function extractIps(value) {
  const matches = String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

module.exports = {
  resolveDomain,
  publicIpv4,
  warnIfDnsMismatch,
  extractIps
};
