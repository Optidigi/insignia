import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Explicit destination keeps an accidental default CLI selection away from the
// historical app/store. The chosen binary can be the project-local Shopify CLI.
const command = process.env.SHOPIFY_CLI_BIN ?? 'shopify';
const child = spawn(command, [
  'app', 'dev', '--path', fileURLToPath(new URL('..', import.meta.url)),
  '--config', 'insignia-public', '--store', 'insignia-rewrite-dev.myshopify.com',
  '--skip-dependencies-installation'
], { stdio: 'inherit', env: process.env });
child.once('error', error => { console.error(`Shopify CLI unavailable: ${error.code}`); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
