// Firebase stand-in for tests/keep.client.test.mjs.
export const state = { signedInWith: null, signedOut: false };
export async function signInWithGoogleAccessToken(t) { state.signedInWith = t; state.signedOut = false; return { email: 'bob@gmail.com' }; }
export async function idToken() { return state.signedOut ? null : 'FBID'; }
export async function signOut() { state.signedOut = true; }
