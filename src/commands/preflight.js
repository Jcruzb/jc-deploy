const { Runner } = require('../core/runner');
const { resolveApp } = require('../services/app.service');
const { runAppPreflight } = require('../services/app-preflight.service');

async function runPreflight(appName) {
  const runner = new Runner({ dryRun: false });
  const app = await resolveApp(appName);
  await runAppPreflight(runner, app);
}

module.exports = {
  runPreflight
};
