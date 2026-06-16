const path = require('path');

function validateGithubUrl(value) {
  if (!value) return 'Introduce una URL de GitHub.';
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value.trim())
    ? true
    : 'La URL debe parecer https://github.com/owner/repo.git';
}

function repoNameFromUrl(value) {
  const clean = value.trim().replace(/\/$/, '');
  const name = clean.split('/').pop().replace(/\.git$/, '');
  return sanitizeAppName(name);
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
  sanitizeAppName,
  validateAppName,
  validateDomain,
  validateAbsolutePath,
  validatePort,
  normalizeApiPath
};
