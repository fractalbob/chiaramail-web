// Test-only mail server: a real Dovecot for IMAP and a small SMTP server that
// delivers what it receives into the recipients' Dovecot inboxes. Plain-text
// logins on 127.0.0.1 only. Used by the desktop mail tests; never shipped.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { SMTPServer } from 'smtp-server';
import { ImapFlow } from 'imapflow';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const waitPort = async (port, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const ok = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (ok) return;
    if (Date.now() > end) throw new Error(`port ${port} never opened`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** users: { 'bob@example.fr': 'secret', ... } */
export async function startMailServer(users) {
  // Dovecot refuses to run its processes as root: mail is owned by a 'vmail' user.
  try { execFileSync('id', ['vmail'], { stdio: 'ignore' }); } catch { execFileSync('useradd', ['-r', '-M', '-s', '/usr/sbin/nologin', 'vmail']); }
  const uid = Number(execFileSync('id', ['-u', 'vmail']).toString().trim());
  const gid = Number(execFileSync('id', ['-g', 'vmail']).toString().trim());
  const root = mkdtempSync(join(tmpdir(), 'cm-mail-'));
  const imapPort = await freePort();
  const smtpPort = await freePort();
  writeFileSync(join(root, 'users'), Object.entries(users).map(([u, p]) => `${u}:{PLAIN}${p}`).join('\n') + '\n');
  mkdirSync(join(root, 'run'));
  const conf = join(root, 'dovecot.conf');
  writeFileSync(conf, `
protocols = imap
listen = 127.0.0.1
ssl = no
disable_plaintext_auth = no
auth_mechanisms = plain login
mail_location = maildir:${root}/mail/%u
default_internal_user = dovecot
default_login_user = dovenull
first_valid_uid = 1
base_dir = ${root}/run
state_dir = ${root}/state
log_path = ${root}/dovecot.log
mail_plugins =
passdb {
  driver = passwd-file
  args = scheme=PLAIN username_format=%u ${root}/users
}
userdb {
  driver = static
  args = uid=${uid} gid=${gid} home=${root}/home/%u
}
service imap-login {
  inet_listener imap {
    address = 127.0.0.1
    port = ${imapPort}
  }
  inet_listener imaps {
    port = 0
  }
}
service anvil {
  chroot =
}
service imap-login {
  chroot =
}
namespace inbox {
  inbox = yes
  separator = /
  mailbox Drafts {
    special_use = \\Drafts
    auto = subscribe
  }
  mailbox Sent {
    special_use = \\Sent
    auto = subscribe
  }
  mailbox Trash {
    special_use = \\Trash
    auto = subscribe
  }
  mailbox Junk {
    special_use = \\Junk
    auto = subscribe
  }
  mailbox Archive {
    special_use = \\Archive
    auto = subscribe
  }
}
`);
  mkdirSync(join(root, 'state'));
  for (const d of ['mail', 'home']) { mkdirSync(join(root, d)); execFileSync('chown', [`${uid}:${gid}`, join(root, d)]); }
  execFileSync('chmod', ['755', root]);
  const dovecot = spawn('dovecot', ['-F', '-c', conf], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  dovecot.stderr.on('data', (d) => { err += d; });
  try { await waitPort(imapPort); } catch (e) { dovecot.kill(); throw new Error(`${e.message}\n${err}`); }

  // SMTP: accept mail for known users and APPEND it to their INBOX.
  const deliver = async (to, raw) => {
    const c = new ImapFlow({ host: '127.0.0.1', port: imapPort, secure: false, auth: { user: to, pass: users[to] }, logger: false });
    await c.connect();
    try { await c.append('INBOX', raw); } finally { await c.logout(); }
  };
  const smtp = new SMTPServer({
    secure: false, authOptional: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true, logger: false,
    onAuth(auth, _s, cb) { return users[auth.username] === auth.password ? cb(null, { user: auth.username }) : cb(new Error('Bad login')); },
    onData(stream, session, cb) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', async () => {
        const raw = Buffer.concat(chunks);
        try {
          for (const r of session.envelope.rcptTo) if (users[r.address.toLowerCase()]) await deliver(r.address.toLowerCase(), raw);
          cb();
        } catch (e) { cb(e); }
      });
    },
  });
  await new Promise((r) => smtp.listen(smtpPort, '127.0.0.1', r));

  return {
    imap: { host: '127.0.0.1', port: imapPort, secure: false },
    smtp: { host: '127.0.0.1', port: smtpPort, secure: false },
    deliver,
    async stop() {
      await new Promise((r) => smtp.close(r));
      dovecot.kill();
      await new Promise((r) => dovecot.once('exit', r));
      try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
