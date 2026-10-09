# ChiaraMail (web) — mail client for Gmail

Live at **https://app.chiaramail.com** (also served at chiaramail-mail.web.app).

A mail app for your Gmail account that brings back ChiaraMail 5.1's core idea:
**ECS messages** (Envelope-Content Splitting). Only the envelope (sender,
recipients, subject) travels by email; the text and attachments are stored
separately, encrypted, so they can't be read in transit and can be changed
after sending.

Your mail stays in Gmail: the browser talks to Google's Gmail API directly.
ChiaraMail stores only the encrypted content of ECS messages (Firestore and
Storage, project `chiaramail-15119`).

> **Option 1** (link-only, no mail client) is kept in git: branch `option-1`,
> tag `v6-option1`. It is still live at https://chiaramail-app.web.app.

## ECS messages

Tick **ECS message** when writing.

- **Encrypted end to end.** Subject, text, attachment names and files are
  encrypted in the sender's browser (AES-256-GCM, a fresh key per message)
  before they're stored. The key travels only inside the email, in the
  `X-ChiaraMail-Content-Key` header and in the link's `#k=` part, which
  browsers never send to a server. ChiaraMail never has the key, so nobody
  looking at its database can read ECS messages. As in 5.1, the email also
  carries an `X-ChiaraMail-Content-Pointer` header.
- **Inline and live.** Recipients who use ChiaraMail see the current edition
  in their inbox, with "Updated since you last read it" when it has changed.
- **Edit and Withdraw.** The sender can edit or withdraw the message from
  inside it, and can see who has read which edition and every earlier edition.
- **Attachments are stored with the content, not the email.** Up to 20 files,
  100 MB each. Ordinary emails and drafts keep Gmail's 24 MB limit; if a draft
  is too big, ChiaraMail suggests sending it as an ECS message.
- **Recipients without ChiaraMail** get a short email with a link to the
  current version. They sign in with the address it was sent to.
- **Forwarding** is off unless the sender ticks "Let recipients forward it".
  It can be switched at any time from the message. When it's off, recipients
  can't forward it from ChiaraMail, and anyone they forward the email to can't
  open the link. When it's on, a forward carries the text as it stood then.
- **Sender verification.** The subject of an ECS message shows green ("✓
  Verified sender") when the email's From matches the person who stored the
  content. It shows red, with "Forged?" and a warning in the message, when
  they don't match.
- **ECS directory.** Names of people who use ChiaraMail show in magenta.
  Everyone who connects is listed in `ecsUsers/{email}`. Anyone signed in can
  check whether a given address is listed, but nobody can browse the list.

## Everyday mail

Read, search, star, archive, delete, reply, forward and attach, as in Gmail:

- **Checkboxes** on every row, plus one at the top to select the whole page.
  The selected messages can be deleted, archived, reported as spam or "Not
  spam", restored from Trash, or marked read or unread together. Drafts have
  "Delete selected".
- **Restore** puts a conversation back where it was. The app remembers which
  deleted conversations came from the Inbox, because Gmail's own "untrash"
  leaves them in All Mail. Notes to yourself return to the Inbox; mail you
  only sent returns to Sent.
- **Dates as in Gmail.**
  - In the list: the time for today, "7 Oct" for this year, a full date for
    older mail.
  - In an opened message: "14:32 (12 minutes ago)", "Wed 7 Oct, 10:15 (2
    days ago)", or "7 Oct 2025, 10:15".
- **Images in emails.** Web images are hidden by default, so senders can't
  tell when you open their mail. "Show images" shows them for one message.
  **Always show images**, under the search bar, shows them everywhere except
  in Spam.
- **Drafts.** They save automatically, can be resumed and discarded, and
  show inside conversations.
- **Recipients.** To, Cc and Bcc use Gmail-style chips, with suggestions
  drawn from your own Gmail. The suggestion list is built when you connect,
  refreshed daily and kept in your browser only.
- **Gmail rate limits.** Requests are retried automatically with increasing
  waits, and you get a plain-language message if Gmail is still busy.
- **English and French.** There's a light and a dark theme, and the layout
  works on phones.
- **Tab icon.** The full-colour ChiaraMail logo across a white envelope
  (`public/favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`).

### What is kept in the browser only

The app keeps a few things in your browser and nowhere else:

| What | Where (localStorage) |
|---|---|
| Recipient suggestions | `chiaramail.contacts.*` |
| The "Always show images" setting | `chiaramail.alwaysImages` |
| Which deleted conversations came from the Inbox | `chiaramail.trashedFromInbox` |
| Keys of ECS messages opened from a link | `chiaramail.ecsKey.{id}` |
| Language | `chiaramail.lang` |
| The address you last connected with, to pre-select it at sign-in | `chiaramail.lastAccount` |
| Google's hour-long Gmail permission (this tab only, sessionStorage) | `chiaramail.gmailToken` |

## Try it with no setup

```
npm install
npm run dev:mock
```

Test mode simulates Gmail and ChiaraMail in your browser. Connect with any
address (e.g. alice@example.com), send an ECS message to bob@example.com, sign
out, connect as Bob, and so on. The simulated Gmail behaves like the real one
where it matters: trashing drops the Inbox label, and mail to yourself is one
message marked both Sent and Inbox.

## One-time setup (already done for chiaramail-15119)

All of this is in project **chiaramail-15119**, at
https://console.cloud.google.com (pick the project at the top).

1. **Enable the Gmail API.** APIs & Services → Library → search "Gmail API" →
   Enable.
2. **Consent screen** (Google Auth Platform):
   - Branding: app name **ChiaraMail**, logo, support email, home page
     `https://app.chiaramail.com`, and links to `/privacy.html` and
     `/terms.html`. The domain chiaramail.com is verified in Search Console.
   - Audience: **External**, **In production**.
   - Data Access: scope `https://www.googleapis.com/auth/gmail.modify`.
3. **Allowed web addresses for sign-in.** APIs & Services → Credentials →
   OAuth 2.0 Client IDs → **Web client (auto created by Google Service)**.
   Under **Authorized JavaScript origins**, add `https://app.chiaramail.com`,
   `https://chiaramail-mail.web.app` and `http://localhost:5173`. Copy the
   **Client ID** into `.env.local` as `VITE_GOOGLE_CLIENT_ID`.
4. **Firebase authorized domains.** Authentication → Settings → Authorized
   domains → `app.chiaramail.com` and `chiaramail-mail.web.app`.
5. **Custom domain.** Hosting → site `chiaramail-mail` → Add custom domain
   `app.chiaramail.com`, with the DNS records it asks for. In `.env.local`, set
   `VITE_PUBLIC_ORIGIN=https://app.chiaramail.com`, so that links in emails
   point there.
6. **Storage for ECS attachments.** Firebase console → Storage. In
   `.env.local`, set `VITE_FIREBASE_STORAGE_BUCKET=chiaramail-15119.appspot.com`.
   Then allow the app's addresses to download from it. In Google Cloud Shell:
   ```
   echo '[{"origin":["https://app.chiaramail.com","https://chiaramail-mail.web.app","http://localhost:5173"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gcloud storage buckets update gs://chiaramail-15119.appspot.com --cors-file=cors.json
   ```
   If Storage reports a permissions problem:
   ```
   gcloud services enable firebasestorage.googleapis.com
   gcloud beta services identity create --service=firebasestorage.googleapis.com
   ```
   Then grant that service account `roles/firebasestorage.serviceAgent`.
7. **Deploy** (hosting, Firestore and Storage rules, indexes):
   ```
   npm run deploy
   ```
   Pages are served with `no-cache` and the hashed files in `/assets/` are
   cached forever, so a deploy takes effect on the next reload.

### Google verification

`gmail.modify` is a restricted scope. Until Google verifies the app, it is
limited to 100 users, and new users see "Google hasn't verified this app" (they
click **Advanced → Continue**). The landing page explains this before the user
reaches Google's screen. Verification is requested from Google Auth Platform
→ Verification Center, with:
- Data Access: "Email client" use, with a justification.
- A demo video of app.chiaramail.com.
- The ECS explainer video, https://youtu.be/p6FqbYWFCCY.

Google's queue is about 4–6 weeks, and a security assessment (CASA) may follow.

Google's Gmail permission lasts about an hour per sign-in. After that,
ChiaraMail asks you to click **Continue with Google** again (no password if
you're already signed in to Google).

## Updating the live site

Unzip a new version over the project, keeping `.env.local`, and deploy:

```
cd ~
unzip -o ~/Downloads/chiaramail-web-vNN.zip
cd chiaramail
npm run deploy
```

Unzipping never deletes files. When a version removes a file, delete it by
hand before deploying.

## Tests

| Command | What it checks |
|---|---|
| `npm run lint` | code style and common mistakes |
| `npm run test:unit` | building and reading MIME messages (accents, attachments, ChiaraMail headers) and the ECS encryption round trip |
| `npm run test:rules` | Firestore and Storage security rules (needs Java 21) |
| `npm run build:mock`, `npx vite preview`, then `BASE=http://localhost:4173 node tests/e2e-mail.mjs shots` | a full multi-person walkthrough in a browser (see below) |

The walkthrough covers:
- ECS send, edit, withdraw, encryption, attachments, forwarding, the web page
  and a forged message;
- checkboxes, delete and restore (including notes to yourself), images,
  drafts, recipients, French, and the phone layout.

## Where things are

- `src/gmail/mime.js` builds and parses email (pure, unit-tested).
- `src/gmail/api.js` holds the Google sign-in token and calls the Gmail REST
  API (retries, restore-to-Inbox). `src/gmail/mock.js` is its test-mode twin.
- `src/ecsCrypto.js` encrypts and decrypts ECS content (pure, unit-tested).
- `src/ecs.js` creates, opens, watches and edits ECS messages and their
  attachments.
- `src/ecsKeys.js` reads a message key from a link's `#k=`.
- `src/mail/` holds the mail screens:
  - `MailLayout.jsx`: layout, folders, the search bar and the images switch;
  - `ThreadList.jsx`: the message list, with checkboxes;
  - `ThreadView.jsx`: an opened conversation;
  - `HtmlBody.jsx`: safe HTML display, with images held back;
  - `Composer.jsx` and `RecipientField.jsx`: writing a message;
  - `DraftList.jsx`: the Drafts folder;
  - `LiveMessage.jsx`: an ECS message's content, inline;
  - `ecsCheck.js`: sender verification and the directory;
  - `contacts.js`: recipient suggestions;
  - `prefs.js`: the images setting.
- `src/backend/` is ChiaraMail's own storage (Firestore and Storage), with its
  test-mode twin.
- `src/components/MessagePage.jsx` is the web page an ECS message links to,
  for readers without ChiaraMail.
- `public/privacy.html` and `public/terms.html` are the privacy policy and
  terms (English and French), linked from Google's consent screen.
- `firestore.rules` controls who may read and change ECS messages and the
  directory. It also keeps the old Android app's `users` rule.
- `storage.rules` controls who may fetch an ECS message's attachments,
  following the message in Firestore. It also keeps the old `content/` rule.

## Not yet included

- rich-text writing;
- applying labels;
- non-Gmail accounts.

© The Fractal Images Company
