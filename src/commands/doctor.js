const { Runner } = require('../core/runner');
const { runDoctorChecks } = require('../services/doctor.service');
const { resolveApp } = require('../services/app.service');
const { runAppPreflight } = require('../services/app-preflight.service');

async function runDoctor(appName) {
  const runner = new Runner({ dryRun: false });
  await runDoctorChecks(runner);
  if (appName) {
    const app = await resolveApp(appName);
    await runAppPreflight(runner, app);
  }
}

module.exports = {
  runDoctor
};
