# ChiaraMail ECS server (Europe)

Keeps the content of ECS messages sent from the ChiaraMail desktop app: their
subject, text and attachments, **already encrypted by the sender's computer**.
The server never has the key (it travels inside the email), so it stores only
ciphertext. What it does see: who sent a message to which addresses, when, and
when each recipient last opened it.

It enforces the same rules as the web app's Firebase version:

- only the sender and the addresses a message was sent to can read it;
- only the sender can correct it (a new edition), withdraw it or delete it;
- every edition is kept, visible to the sender only;
- attachments: up to 20 per message, 25 MB each, 1 GB in all per sender;
- sign-in with a 6-digit code emailed to the address (valid 15 minutes, 5 tries;
  at most 5 codes an hour per address). The desktop app finds the code in the
  person's inbox and enters it itself.

Built with Node.js and PostgreSQL only. Attachments are kept as files on the
server's own disk. No outside service is involved.

## Running it at OVHcloud

What's needed:

1. **A server in France**: an OVHcloud VPS (e.g. "VPS-1", Gravelines, Strasbourg
   or Roubaix datacentre) with Ubuntu 24.04, or a Public Cloud instance.
2. **A domain name** for it, e.g. `ecs.chiaramail.fr`, pointing to the server
   (an A record).
3. **A mailbox to send the sign-in codes from**, e.g. `codes@chiaramail.fr` at
   OVHcloud (an MX Plan mailbox is enough). The codes are sent through its SMTP
   server, `ssl0.ovh.net`, port 465.

### 1. Install

```
sudo apt update && sudo apt install -y nodejs npm postgresql nginx certbot python3-certbot-nginx
sudo -u postgres createuser chiaramail
sudo -u postgres createdb -O chiaramail chiaramail
sudo -u postgres psql -c "ALTER USER chiaramail PASSWORD 'choose-a-long-password'"
sudo useradd -r -m -d /srv/chiaramail chiaramail
sudo -u chiaramail git clone https://github.com/fractalbob/chiaramail-web.git /srv/chiaramail/app
cd /srv/chiaramail/app/server && sudo -u chiaramail npm ci --omit=dev
```

(Node.js 22 or later is needed. If Ubuntu's is older, install it from
nodesource or with `nvm`.)

### 2. Settings

`/srv/chiaramail/ecs.env` (readable by the chiaramail user only: `chmod 600`):

```
DATABASE_URL=postgres://chiaramail:choose-a-long-password@127.0.0.1:5432/chiaramail
FILES_DIR=/srv/chiaramail/files
SECRET=<output of: openssl rand -hex 32>
ORIGINS=app://chiaramail
TRUST_PROXY=1
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=465
SMTP_USER=codes@chiaramail.fr
SMTP_PASS=<that mailbox's password>
MAIL_FROM=ChiaraMail <codes@chiaramail.fr>
```

### 3. Start it with the system

`/etc/systemd/system/chiaramail-ecs.service`:

```
[Unit]
Description=ChiaraMail ECS server
After=network.target postgresql.service

[Service]
User=chiaramail
WorkingDirectory=/srv/chiaramail/app/server
EnvironmentFile=/srv/chiaramail/ecs.env
ExecStart=/usr/bin/node src/index.js
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/chiaramail/files
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```
sudo mkdir -p /srv/chiaramail/files && sudo chown chiaramail /srv/chiaramail/files
sudo systemctl daemon-reload && sudo systemctl enable --now chiaramail-ecs
```

### 4. HTTPS in front (nginx)

`/etc/nginx/sites-available/chiaramail-ecs`:

```
server {
  server_name ecs.chiaramail.fr;
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
  }
}
```

```
sudo ln -s /etc/nginx/sites-available/chiaramail-ecs /etc/nginx/sites-enabled/
sudo certbot --nginx -d ecs.chiaramail.fr
```

Check: `curl https://ecs.chiaramail.fr/health` answers `{"ok":true}`.

### The reader page

Recipients without the app open the link in the email (`https://<server>/m/<id>#k=…`)
in their browser: they sign in with a 6-digit code emailed to them, and the
message is decrypted in the browser with the key from the link (the part after
`#`, which browsers never send to the server). The page is built at the top
level and served by this server itself, from `server/reader`:

```
npm run build:reader          # on the developer's computer
rsync -a --exclude node_modules server ubuntu@<server>:   # then, on the server:
sudo rsync -a --delete --exclude node_modules ~/server/ /srv/chiaramail/app/server/ && sudo chown -R chiaramail /srv/chiaramail/app
sudo systemctl restart chiaramail-ecs
```

### 5. Point the desktop app at it

In `desktop/package.json`: `"chiaramail": { "ecsUrl": "https://ecs.chiaramail.fr", ... }`,
then rebuild the app.

### Backups

Everything is in two places: the database and `FILES_DIR`. A nightly copy,
kept at OVHcloud (another VPS disk, or OVHcloud Object Storage in France):

```
pg_dump -Fc chiaramail > /srv/chiaramail/backup/db-$(date +%F).dump
tar czf /srv/chiaramail/backup/files-$(date +%F).tgz -C /srv/chiaramail files
```

## Who runs it

Whoever has administrator access to this server and its database can be
compelled to hand over what's there. The content is ciphertext they can't read,
but the envelope data (addresses, dates, read times) is readable. For clients
who need the data out of reach of non-EU law, it should be run by a French
company with French management, and the developer should have no access to the
live server.

## Tests

```
npm install
npm test        # needs PostgreSQL installed (the tests start their own private copy)
```
