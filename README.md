# ChiaraMail (web)

Email you can still change after you send it. This is the web successor to
ChiaraMail 5.1 (Java, 2001–2009). It keeps the original's core invention: the
message text lives on a server, not in the email, so the sender can change or
withdraw it, and only the listed recipients can read it.

**How it works**

1. The sender writes the message in ChiaraMail. It's stored in Firestore.
2. ChiaraMail opens a ready-made email in the sender's own mail program
   (or Gmail / Outlook.com, or copy-and-paste). The email holds a link to
   the message.
3. A recipient opens the link and signs in with the address it was sent to
   (Google, or a one-click email link). Then they see the current edition.
4. The sender can save new editions at any time. Every edition is kept
   for the sender. Readers see a highlighted "Updated since you last read
   it" when the text changed. The sender sees who has read which edition.
   Withdrawing a message erases its text for everyone.

| Original (5.1)                        | Web version                              |
|---------------------------------------|------------------------------------------|
| `RECEIVE CONTENT` → content server    | `createMessage` → Firestore `messages/`  |
| `X-ChiaraMail-Content-Pointer` header | link `/m/<id>` in the email              |
| `FETCH CONTENT` + `isRecipient()`     | Firestore rules: verified recipient only |
| `UPDATE CONTENT`                      | `saveEdition` (new edition, history kept)|
| recipient needs ChiaraMail installed  | any browser, any device                  |

Not carried over (deliberately): the IMAP/SMTP inbox, the spam filter and the
category server.

## Try it with no setup

```
npm install
npm run dev:mock
```

Test mode uses a stand-in backend in your browser. No Firebase is needed, and
"sign-in links" sign you in immediately. Sign out and in as different addresses
to play sender and recipient.

## Set up Firebase (one time)

ChiaraMail web lives in the existing **ChiaraMail** project, `chiaramail-15119`,
which is already on Blaze with a budget alert. That project also holds the old
ChiaraMail pieces, which must keep working:

- the **original website** (the chiaramail.com page with app links) on the
  project's default Hosting site. The web app deploys to a **separate site,
  `chiaramail-app`**, so it never touches that page.
- the old Android app's **`users`** collection in Firestore. `firestore.rules`
  keeps its original rule word for word, next to the new `messages` rules.
- the Realtime Database, which this app doesn't use or deploy.

Steps:

1. **Authentication → Sign-in method.** Make sure **Google** is enabled, and
   **Email/Password** with **Email link (passwordless sign-in)** turned on.
2. **Settings → General → Your apps → Add app → Web.** Name it `chiaramail-web`
   and leave "Firebase Hosting" unticked. Copy its config into `.env.local`
   (see `.env.example`). For now, set
   `VITE_PUBLIC_ORIGIN=https://chiaramail-app.web.app`.
3. Log in and create the second Hosting site:
   ```
   npx firebase login
   npx firebase hosting:sites:create chiaramail-app
   ```
   (If that name is taken, pick another, and put it in `.firebaserc` in place of
   `chiaramail-app`.)
4. **Authentication → Settings → Authorized domains → Add domain:**
   `chiaramail-app.web.app`.
5. Test the rules (see below), then deploy:
   ```
   npm run deploy
   ```
   This deploys only the new site plus Firestore rules and indexes. The old
   site and the Realtime Database are left alone.
6. **app.chiaramail.com.** chiaramail.com keeps its existing page, so the app
   gets a subdomain (like play.p3nto.com):
   - Hosting → open the **chiaramail-app** site → **Add custom domain** →
     `app.chiaramail.com`. Add the record(s) Firebase shows where
     chiaramail.com's DNS is managed. Leave every other record, including any
     MX (mail) records, as it is.
   - Authentication → Settings → Authorized domains → add `app.chiaramail.com`.
   - Set `VITE_PUBLIC_ORIGIN=https://app.chiaramail.com` in `.env.local`, then
     `npm run deploy` again so message links use that address.

**Note on the old `users` rule.** It is `allow read,write: if true`, so anyone
on the internet can read or overwrite those device registrations. It is kept
unchanged so as not to break the old Android app. If that app is retired,
delete that block (or tighten it) and redeploy.

## Check the security rules

`firestore.rules` is what keeps messages private. The tests in
`tests/rules.test.js` cover: senders can't impersonate; only verified
recipients can read (case-insensitive); outsiders can't read or list; only the
sender can edit or withdraw; withdrawal is final; edition history is
sender-only; read receipts can only be written by the reader. Run them (needs
Java 11+, which the Firebase emulator uses):

```
npm run test:rules
```

## Other commands

| Command              | What it does                                         |
|----------------------|------------------------------------------------------|
| `npm run dev`        | Local dev server against your real Firebase project  |
| `npm run dev:mock`   | Local dev server in test mode                        |
| `npm run lint`       | ESLint                                               |
| `npm run build`      | Production build into `dist/`                        |
| `node tests/e2e.mjs` | Browser walkthrough (after `npm run build:mock && npx vite preview`) |

## Where things are

- `src/backend/firebase.js`: all Firebase calls. `src/backend/mock.js` is the test-mode twin.
- `src/components/`: screens (Landing, Home, Compose, MessagePage, Letter, SendPanel, SenderTools).
- `src/i18n.jsx`: English and French text.
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`: Firebase config.

Data model: `messages/{id}` holds `senderUid, senderEmail, senderName,
recipients[], subject, body, createdAt, updatedAt, edition, withdrawn`. It has
two subcollections: `editions/{n}`, visible to the sender only, and
`reads/{email}`, the read receipts.

© The Fractal Images Company
