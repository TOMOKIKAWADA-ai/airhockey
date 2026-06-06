import { spawn } from 'node:child_process';

const processes = [
  {
    name: 'server',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'server'],
  },
  {
    name: 'front',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
  },
];

const children = processes.map((entry) => {
  const child = spawn(entry.command, entry.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${entry.name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${entry.name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && !shuttingDown) {
      console.error(`[${entry.name}] exited with ${code}`);
      shutdown(code);
    }
  });
  return child;
});

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
