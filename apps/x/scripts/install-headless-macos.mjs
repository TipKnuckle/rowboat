#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

if (process.platform !== 'darwin') throw new Error('This installer is for macOS.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/server/dist-headless');
if (!fs.existsSync(path.join(source, 'rowboat-server.cjs'))) throw new Error('Build @x/server and run its build:headless script first.');
const service = 'com.craigt.rowboat-server';
const workDir = path.join(os.homedir(), '.rowboat');
const installRoot = path.join(os.homedir(), '.local/share/rowboat-server');
const release = path.join(installRoot, 'releases', new Date().toISOString().replaceAll(':', '-'));
const logDir = path.join(os.homedir(), 'Library/Logs/rowboat-server');
const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${service}.plist`);
const domain = `gui/${process.getuid()}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run('launchctl', ['print', domain], { stdio: 'ignore' });
fs.mkdirSync(release, { recursive: true });
fs.cpSync(source, release, { recursive: true });
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: release });
fs.mkdirSync(path.join(workDir, 'config'), { recursive: true, mode: 0o700 });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(path.dirname(plist), { recursive: true });
const configPath = path.join(workDir, 'config/server.json');
const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
fs.writeFileSync(configPath, JSON.stringify({ ...existing, lanEnabled: true, port: 3220 }, null, 2) + '\n', { mode: 0o600 });

const definition = {
  Label: service,
  ProgramArguments: [process.execPath, path.join(release, 'rowboat-server.cjs')],
  WorkingDirectory: release,
  EnvironmentVariables: {
    ROWBOAT_WORKDIR: workDir,
    ROWBOAT_SERVER_VERSION: JSON.parse(fs.readFileSync(path.join(release, 'package.json'), 'utf8')).version,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  },
  RunAtLoad: true,
  KeepAlive: true,
  ThrottleInterval: 10,
  StandardOutPath: path.join(logDir, 'stdout.log'),
  StandardErrorPath: path.join(logDir, 'stderr.log'),
};
const temporary = `${plist}.tmp`;
run('/usr/bin/plutil', ['-convert', 'xml1', '-o', temporary, '-'], { input: JSON.stringify(definition), stdio: ['pipe', 'inherit', 'inherit'] });
run('/usr/bin/plutil', ['-lint', temporary]);
// 2026-10-21: launchd can finish bootout asynchronously during headless upgrades.
spawnSync('launchctl', ['bootout', `${domain}/${service}`], { stdio: 'ignore' });
fs.renameSync(temporary, plist);
for (let attempt = 0; attempt < 10; attempt++) {
  const result = spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 0) break;
  if (attempt === 9) throw new Error(`launchctl bootstrap failed: ${result.stderr.trim()}`);
  await setTimeout(500);
}
console.log(`Installed ${service}\nWorkdir: ${workDir}\nLogs: ${logDir}\nToken file: ${path.join(workDir, 'server-key')}`);
console.log('Runs independently of SSH and restarts after crashes. Starts at user login, not before login at boot.');
