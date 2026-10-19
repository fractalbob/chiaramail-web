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

## How it fits together

- `main/main.js`: the app window; serves `renderer/` as `app://chiaramail/`.
- `main/preload.cjs`: the few calls the screens may make.
- `main/account.js`: the signed-in account; the password is encrypted with the
  system's keychain (Electron safeStorage) in the app's data folder.
- `main/mail/service.js`: IMAP/SMTP presented with the same functions as the
  Gmail module (`src/gmail/api.js`), so the screens are unchanged.
- `main/mail/detect.js`: finds a provider's servers from the address.
- `../src/gmail/desktop.js`, `../src/backend/desktop.js`: the screens' side.

Changeable (ECS) messages are switched off until the European ECS server exists.

## Tests

```
cd desktop && npm test                                   # mail layer, against a real Dovecot server
cd .. && npm run build:desktop && xvfb-run -a node desktop/test/app.e2e.mjs   # the whole app
```

The tests need `dovecot` installed (they start their own private copy).
