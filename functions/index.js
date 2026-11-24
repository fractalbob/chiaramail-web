// Cloud Functions for the ChiaraMail Gmail web app: "Keep me signed in" (keep.js).
// Served on the app's own address through Hosting rewrites (firebase.json):
//   POST /api/gmail/keep    the one-time code → kept refresh token, access token
//   POST /api/gmail/token   a fresh access token (signed in to ChiaraMail)
//   POST /api/gmail/forget  sign out: the refresh token is revoked and deleted
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import * as keepLib from './keep.js';

initializeApp();
const CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const KEEP_KEY = defineSecret('KEEP_KEY');

// Refresh tokens, encrypted, one per Google account. Firestore rules deny every
// client access to this collection; only these functions can read it.
const col = () => getFirestore().collection('gmailKeep');
const store = {
  get: async (sub) => { const s = await col().doc(sub).get(); return s.exists ? s.data() : null; },
  set: (sub, data) => col().doc(sub).set(data),
  delete: (sub) => col().doc(sub).delete(),
};
const google = new OAuth2Client();
const verifyGoogleIdToken = async (idToken, audience) => (await google.verifyIdToken({ idToken, audience })).getPayload();
const verifyIdToken = (t) => getAuth().verifyIdToken(t, true);

const handler = (fn) => onRequest(
  { region: 'us-central1', invoker: 'public', secrets: [CLIENT_SECRET, KEEP_KEY], maxInstances: 10, memory: '256MiB' },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const cfg = { clientId: CLIENT_ID.value(), clientSecret: CLIENT_SECRET.value(), key: KEEP_KEY.value() };
      res.json(await fn({ req, cfg, store, fetchFn: fetch, verifyGoogleIdToken, verifyIdToken }));
    } catch (e) {
      const status = e instanceof keepLib.HttpError ? e.status : 500;
      if (status === 500) console.error(e); // never logs tokens: they are not in the error
      res.status(status).json({ error: e.code || 'error' });
    }
  },
);

export const gmailKeep = handler(keepLib.keep);
export const gmailToken = handler(keepLib.token);
export const gmailForget = handler(keepLib.forget);
