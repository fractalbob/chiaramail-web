# ChiaraMail (web) — mail client for Gmail

A mail app for your Gmail account that brings back ChiaraMail 5.1's core idea:
**ECS messages** (Envelope-Content Splitting). Read, search, star, archive,
delete, reply, forward and attach as in any mail app. Tick **ECS message** when
writing, and only the envelope (sender, recipients, subject) travels by email;
the text and attachments live in ChiaraMail, so they can't be read in transit
and can be changed after sending:

- The email carries an `X-ChiaraMail-Content-Pointer` header, as in 5.1.
- Recipients who use ChiaraMail see the **current edition inline** in their
  inbox, with "Updated since you last read it" when it changed.
- The sender sees **Edit** and **Withdraw** right in the message, plus who has
  read which edition, and every earlier edition.
- Recipients without ChiaraMail get a short email with a link to the current
  version (they sign in with the address it was sent to).
- **Forwarding** is off unless the sender ticks "Let recipients forward it"
  (can be switched at any time from the message). When it's off, recipients can't
  forward it from ChiaraMail, and anyone they forward the email to can't open
  the link. When it's on, a forward carries the text as it stood then.

Your mail stays in Gmail: the browser talks to Google's Gmail API directly.
ChiaraMail stores only the content of ECS messages (Firestore and Storage,
project `chiaramail-15119`).

> **Option 1** (link-only, no mail client) is kept in git: branch `option-1`,
> tag `v6-option1`. It is still live at https://chiaramail-app.web.app.
> This version deploys to its own site, **chiaramail-mail.web.app**.

## Try it with no setup

```
npm install
npm run dev:mock
```

Test mode simulates Gmail and ChiaraMail in your browser. Connect with any
address (e.g. alice@example.com), send an ECS message to
bob@example.com, sign out, connect as Bob, and so on.

## One-time Google Cloud setup (for real Gmail)

All in the existing project **chiaramail-15119**, at https://console.cloud.google.com
(pick the project at the top).

1. **Enable the Gmail API.** APIs & Services → Library → search "Gmail API" →
   Enable.
2. **Consent screen** (Google Auth Platform → Branding / Audience / Data Access):
   - Branding: app name **ChiaraMail**, your support email.
   - Audience: **External**, leave it in **Testing**, and under **Test users**
     add every Gmail address that should be able to use it (yours first, up to
     100).
   - Data Access → Add or remove scopes → tick
     `https://www.googleapis.com/auth/gmail.modify` → Update → Save.
3. **Allowed web addresses for sign-in.** APIs & Services → Credentials → OAuth
   2.0 Client IDs → **Web client (auto created by Google Service)**. Under
   **Authorized JavaScript origins** add:
   - `https://chiaramail-mail.web.app`
   - `http://localhost:5173` (for `npm run dev`)
   - later, `https://app.chiaramail.com` if you put it there.
   Save, and copy the **Client ID** into `.env.local` as `VITE_GOOGLE_CLIENT_ID`.
4. **Firebase**: Authentication → Settings → Authorized domains → add
   `chiaramail-mail.web.app` (and `app.chiaramail.com`).
5. **Storage for ECS attachments.** Firebase console → Storage → Get started.
   Copy the bucket name (without `gs://`) into `.env.local` as
   `VITE_FIREBASE_STORAGE_BUCKET`. Then allow the app's addresses to download
   from it — in Google Cloud Shell:
   ```
   echo '[{"origin":["https://app.chiaramail.com","https://chiaramail-mail.web.app","http://localhost:5173"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gcloud storage buckets update gs://chiaramail-15119.appspot.com --cors-file=cors.json
   ```
6. **Second site and deploy:**
   ```
   npx firebase hosting:sites:create chiaramail-mail
   npm run deploy
   ```

While the app is in Testing, Google shows "Google hasn't verified this app" on
the sign-in screen; test users click **Continue**. Opening it to everyone needs
Google's verification of the restricted Gmail scope (and possibly a paid
security assessment). That is only needed for the public, not for you and
your testers.

Google's Gmail permission lasts about an hour per sign-in. After that,
ChiaraMail asks you to click **Continue with Google** again (no password if
you're already signed in to Google).

## Tests

| Command | What it checks |
|---|---|
| `npm run test:unit` | building and reading MIME messages (accents, attachments, the ChiaraMail header) |
| `npm run test:rules` | Firestore and Storage security rules (needs Java 21) |
| `npm run build:mock`, `npx vite preview`, then `BASE=http://localhost:4173 node tests/e2e-mail.mjs shots` | full two-person walkthrough in a browser |

## Where things are

- `src/gmail/mime.js` — build and parse email (pure, unit-tested)
- `src/gmail/api.js` — Google sign-in token + Gmail REST API; `src/gmail/mock.js` is the test-mode twin
- `src/mail/` — mail screens: layout & folders, thread list, thread view, safe HTML view, composer, `LiveMessage` (an ECS message's content, inline)
- `src/backend/` — ChiaraMail's own storage (Firestore) and its test-mode twin
- `src/components/MessagePage.jsx` — the web page an ECS message links to, for readers without ChiaraMail
- `firestore.rules` — who may read and change ECS messages (also keeps the old Android app's `users` rule)
- `storage.rules` — who may fetch an ECS message's attachments (follows the message in Firestore)

## Not yet included

Rich-text writing, applying labels, multi-select in lists, and
non-Gmail accounts. HTML emails are shown with scripts removed and web images
held back until you click "Show images".

© The Fractal Images Company
