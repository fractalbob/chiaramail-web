// Desktop app, until the European ECS server is ready: the local stand-in
// (mock.js) keeps the session and preferences on this computer, and sending
// ECS messages is switched off (ecsReady), so nothing is stored anywhere else.
// The ECS server at OVHcloud will replace this file.
export * from './mock.js';
export const mode = 'desktop';
export const ecsReady = false;
