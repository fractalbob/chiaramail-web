# ChiaraMail desktop

The ChiaraMail screens in a desktop app (Electron) that works with any mail
provider over IMAP and SMTP: Orange, Free, SFR, La Poste, OVHcloud, a company's
own domain… Mail goes straight between this computer and the provider; Google
and Firebase are not involved.

## Try it

From the top folder (`chiaramail/`):

```
npm run build:desktop          # builds the screens into desktop/renderer
cd desktop && npm install      # first time only
npm start
```

Sign in with an email address and its password. The servers are found
automatically for well-known providers and for domains that publish their
settings; otherwise open **Server settings** and type them in. Gmail, Yahoo and
iCloud need an *app password* (created in the account's security settings).

## Installers

Built on GitHub: **Actions → Desktop installers → Run workflow**, giving the ECS
server's address. About ten minutes later the run's page lists, under
**Artifacts**, `ChiaraMail-Windows` (.exe), `ChiaraMail-macOS` (.dmg, Apple
silicon and Intel) and `ChiaraMail-Linux` (.AppImage). Locally: `npm run dist`
builds the one for this computer's system.

They aren't signed yet (a Microsoft code-signing certificate and an Apple
developer account are needed for that), so Windows and macOS warn the first
time; `INSTALLER-fr.md` tells testers how to go past the warning.

## How it fits together

- `main/main.js`: the app window; serves `renderer/` as `app://chiaramail/`.
- `main/preload.cjs`: the few calls the screens may make.
- `main/account.js`: the signed-in account; the password is encrypted with the
  system's keychain (Electron safeStorage) in the app's data folder.
- `main/mail/service.js`: IMAP/SMTP presented with the same functions as the
  Gmail module (`src/gmail/api.js`), so the screens are unchanged.
- `main/mail/detect.js`: finds a provider's servers from the address.
- `../src/gmail/desktop.js`, `../src/backend/desktop.js`: the screens' side.

Changeable (ECS) messages go through ChiaraMail's European ECS server
(`../server/`), set in `package.json` → `chiaramail.ecsUrl`. The app signs in
to it by itself: the server emails a code, the app finds it in the inbox,
enters it and deletes that email. With no server set, ECS stays off.
`main/ecs.js` holds that connection; `../src/backend/desktop.js` is the screens' side.

## Tests

```
cd desktop && npm test                                   # mail layer, against a real Dovecot server
cd .. && npm run build:desktop && xvfb-run -a node desktop/test/app.e2e.mjs   # the whole app
xvfb-run -a node desktop/test/ecs.e2e.mjs   # ECS between two users, through the server
```

The tests need `dovecot` and PostgreSQL installed (they start their own private copies).
