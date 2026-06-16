const path = require('path');

function validateGithubUrl(value) {
  if (!value) return 'Introduce una URL de GitHub.';
  return parseGithubRepo(value)
    ? true
    : 'La URL debe parecer https://github.com/owner/repo.git o git@github.com:owner/repo.git';
}

function repoNameFromUrl(value) {
  const parsed = parseGithubRepo(value);
  if (!parsed) return '';
  return sanitizeAppName(parsed.repo);
}

function parseGithubRepo(value) {
  const clean = String(value || '').trim().replace(/\/$/, '');
  const httpsMatch = clean.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return {
      protocol: 'https',
      owner: httpsMatch[1],
      repo: httpsMatch[2]
    };
  }

  const sshMatch = clean.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      protocol: 'ssh',
      owner: sshMatch[1],
      repo: sshMatch[2]
    };
  }

  return null;
}

function suggestedSshUrl(value) {
  const parsed = parseGithubRepo(value);
  if (!parsed) return null;
  return `git@github.com:${parsed.owner}/${parsed.repo}.git`;
}

function sanitizeAppName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateAppName(value) {
  if (!value) return 'Introduce un nombre de app.';
  return sanitizeAppName(value) === value ? true : 'Usa solo minusculas, numeros, puntos, guiones y guiones bajos.';
}

function validateDomain(value) {
  if (!value) return 'Introduce un dominio.';
  return /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim()) ? true : 'Introduce un dominio valido.';
}

function validateAbsolutePath(value) {
  if (!value) return 'Introduce una ruta.';
  return path.isAbsolute(value.trim()) ? true : 'La ruta debe ser absoluta.';
}

function validatePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? true : 'Introduce un puerto entre 1 y 65535.';
}

function normalizeApiPath(value) {
  let apiPath = String(value || '/api').trim();
  if (!apiPath.startsWith('/')) apiPath = `/${apiPath}`;
  return apiPath.replace(/\/+$/, '') || '/';
}

module.exports = {
  validateGithubUrl,
  repoNameFromUrl,
  parseGithubRepo,
  suggestedSshUrl,
  sanitizeAppName,
  validateAppName,
  validateDomain,
  validateAbsolutePath,
  validatePort,
  normalizeApiPath
};
