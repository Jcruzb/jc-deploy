const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { logger } = require('../core/logger');

function siteAvailablePath(appName) {
  return path.join('/etc/nginx/sites-available', appName);
}

function siteEnabledPath(appName) {
  return path.join('/etc/nginx/sites-enabled', appName);
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}

async function installSite(runner, appName, configContent) {
  const tmpFile = path.join(os.tmpdir(), `jc-deploy-${appName}-nginx.conf`);
  const available = siteAvailablePath(appName);
  const enabled = siteEnabledPath(appName);

  if (runner.dryRun) {
    logger.title('Nginx generado');
    console.log(configContent);
    logger.command(`sudo cp ${tmpFile} ${available}`);
    logger.command(`sudo ln -sfn ${available} ${enabled}`);
    logger.warn('dry-run: instalacion de Nginx omitida');
    return;
  }

  await fs.writeFile(tmpFile, configContent, 'utf8');
  const domains = extractServerNames(configContent);
  for (const domain of domains) {
    await warnIfDomainAppears(runner, domain);
  }

  try {
    await runner.sudo('test', ['-f', available], {
      spinner: false,
      display: `sudo test -f ${available}`
    });
    const backup = `${available}.backup-${timestamp()}`;
    await runner.sudo('cp', [available, backup], {
      message: 'Creando backup de configuracion Nginx existente',
      success: `Backup creado: ${backup}`
    });
  } catch (_) {
    logger.info('No existe configuracion Nginx previa con ese nombre.');
  }

  await runner.sudo('cp', [tmpFile, available], {
    message: 'Instalando configuracion Nginx',
    success: 'Configuracion Nginx instalada'
  });
  await runner.sudo('ln', ['-sfn', available, enabled], {
    message: 'Activando site Nginx',
    success: 'Site Nginx activo'
  });
}

async function warnIfDomainAppears(runner, domain) {
  try {
    const result = await runner.sudo('grep', ['-R', domain, '/etc/nginx/sites-available', '/etc/nginx/sites-enabled'], {
      spinner: false,
      display: `sudo grep -R ${domain} /etc/nginx/sites-available /etc/nginx/sites-enabled`
    });
    if (result.stdout) logger.warn(`El dominio ${domain} aparece en otra configuracion Nginx.`);
  } catch (_) {}
}

function extractServerNames(configContent) {
  const match = String(configContent).match(/server_name\s+([^;]+);/);
  if (!match) return [];
  return match[1].split(/\s+/).filter(Boolean);
}

async function testAndReload(runner) {
  await runner.sudo('nginx', ['-t'], {
    message: 'Validando Nginx',
    success: 'Nginx valido'
  });
  await runner.sudo('systemctl', ['reload', 'nginx'], {
    message: 'Recargando Nginx',
    success: 'Nginx recargado'
  });
}

function domainList(domain, includeWww) {
  return includeWww ? [domain, `www.${domain}`] : [domain];
}

module.exports = {
  siteAvailablePath,
  siteEnabledPath,
  installSite,
  testAndReload,
  domainList,
  extractServerNames
};
