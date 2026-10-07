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

1. In the [Firebase console](https://console.firebase.google.com), **create a
   project** (e.g. `chiaramail`). Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method.** Enable:
   - **Google**
   - **Email/Password**, and inside it turn on **Email link (passwordless sign-in)**.
3. **Upgrade to Blaze** (Usage and billing). On the free Spark plan Firebase
   sends only **5 sign-in-link emails per day**. On Blaze, that becomes 25,000.
   At ChiaraMail's scale this stays within the no-cost allowances. Setting a
   budget alert (e.g. €5) is a good idea anyway. Google sign-in works on
   either plan.
4. **Build → Firestore Database → Create database** (production mode, region
   `europe-west1` or `eur3`).
5. **Project settings → Your apps → Add app → Web.** Copy the config values
   into a new file `.env.local` (see `.env.example`).
6. Connect this folder to the project:
   ```
   npx firebase login
   npx firebase use --add        # pick the project, alias "default"
   ```
7. Deploy (hosting + security rules + indexes):
   ```
   npm run deploy
   ```
   The app is then live at `https://<project-id>.web.app`.
8. **Custom domain (optional):** Hosting → Add custom domain (e.g.
   `chiaramail.com` or `mail.thefractalimagescompany.com`). Then add the same
   domain under Authentication → Settings → **Authorized domains**, or sign-in
   links won't work there.

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
