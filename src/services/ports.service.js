const { logger } = require('../core/logger');

const DEFAULT_PORTS = [3000, 3001, 3002, 3003, 4000, 4001, 5000];

async function showListeningPorts(runner) {
  try {
    const result = await runner.sudo('ss', ['-tulpn'], {
      spinner: false,
      display: 'sudo ss -tulpn'
    });
    const lines = result.stdout
      .split('\n')
      .filter((line) => /LISTEN/i.test(line));
    if (lines.length) {
      logger.title('Puertos ocupados');
      console.log(lines.join('\n'));
    } else {
      logger.info('No se detectaron puertos LISTEN con ss.');
    }
    return lines;
  } catch (error) {
    logger.warn('No pude listar puertos con ss. Continuo con sugerencia por defecto.');
    return [];
  }
}

function suggestFreePort(listeningLines, candidates = DEFAULT_PORTS) {
  const occupied = new Set();
  for (const line of listeningLines) {
    const matches = line.matchAll(/:(\d+)\b/g);
    for (const match of matches) occupied.add(Number(match[1]));
  }
  return candidates.find((port) => !occupied.has(port)) || candidates[0];
}

function occupiedPortsFromLines(listeningLines) {
  const occupied = new Set();
  for (const line of listeningLines) {
    const matches = line.matchAll(/:(\d+)\b/g);
    for (const match of matches) occupied.add(Number(match[1]));
  }
  return occupied;
}

function isPortOccupied(listeningLines, port) {
  return occupiedPortsFromLines(listeningLines).has(Number(port));
}

module.exports = {
  DEFAULT_PORTS,
  showListeningPorts,
  suggestFreePort,
  occupiedPortsFromLines,
  isPortOccupied
};
