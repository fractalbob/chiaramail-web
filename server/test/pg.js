// Test-only: a private PostgreSQL in a temporary folder, on a free port, with
// trust logins on 127.0.0.1. Stopped and deleted after the tests.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const BIN = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const asPg = (cmd, args, opts = {}) => (process.getuid?.() === 0
  ? execFileSync('runuser', ['-u', 'postgres', '--', join(BIN, cmd), ...args], opts)
  : execFileSync(join(BIN, cmd), args, opts));

export async function startPostgres() {
  const root = mkdtempSync(join(tmpdir(), 'cm-pg-'));
  chmodSync(root, 0o777);
  const data = join(root, 'data');
  asPg('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-sync', '-E', 'UTF8'], { stdio: 'ignore' });
  const port = await freePort();
  const opts = `-p ${port} -k ${root} -c listen_addresses=127.0.0.1 -c fsync=off`;
  asPg('pg_ctl', ['-D', data, '-o', opts, '-l', join(root, 'log'), '-w', '-t', '30', 'start'], { stdio: 'ignore' });
  asPg('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'chiaramail']);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/chiaramail`,
    async stop() {
      asPg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
      rmSync(root, { recursive: true, force: true });
    },
  };
}
