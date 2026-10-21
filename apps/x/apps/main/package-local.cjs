const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

// 2026-10-21: local unsigned builds reuse Forge's asset staging without its task runner.
// The existing asset hook stages native modules already.
process.env.ROWBOAT_SKIP_CODE_SIGNING = '1';
const config = require('./forge.config.cjs');
const cliRequire = createRequire(require.resolve('@electron-forge/cli/package.json'));
const coreRequire = createRequire(cliRequire.resolve('@electron-forge/core/package.json'));
const packager = coreRequire('@electron/packager');

async function main() {
  process.chdir(__dirname);
  if (!process.argv.includes('--skip-build')) {
    await config.hooks.generateAssets(config, process.platform, process.arch);
  }
  const outputs = await packager({
    ...config.packagerConfig,
    dir: __dirname,
    out: path.join(__dirname, 'out'),
    overwrite: true,
    platform: process.platform,
    arch: process.arch,
    electronVersion: require('electron/package.json').version,
  });
  if (process.platform === 'darwin') {
    for (const output of outputs) {
      const app = path.join(output, 'Rowboat.app');
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
      execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    }
  }
  console.log('Packaged:', outputs.join('\n'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
