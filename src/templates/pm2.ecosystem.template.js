function commandToPm2(command) {
  const parts = String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { script: 'npm', args: 'start' };
  if (parts[0] === 'npm') return { script: 'npm', args: parts.slice(1).join(' ') };
  if (parts[0] === 'yarn') return { script: 'yarn', args: parts.slice(1).join(' ') };
  if (parts[0] === 'pnpm') return { script: 'pnpm', args: parts.slice(1).join(' ') };
  return { script: parts[0], args: parts.slice(1).join(' ') };
}

function pm2EcosystemTemplate({ appName, cwd, startCommand, port }) {
  const pm2Command = commandToPm2(startCommand);
  return `module.exports = {
  apps: [
    {
      name: ${JSON.stringify(appName)},
      script: ${JSON.stringify(pm2Command.script)},
      args: ${JSON.stringify(pm2Command.args)},
      cwd: ${JSON.stringify(cwd)},
      env: {
        NODE_ENV: "production",
        PORT: ${JSON.stringify(String(port))}
      }
    }
  ]
};
`;
}

module.exports = {
  pm2EcosystemTemplate
};
