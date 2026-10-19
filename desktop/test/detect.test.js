// Finding a provider's servers from an email address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, parseAutoconfig } from '../main/mail/detect.js';

test('well-known French providers, without any lookup', async () => {
  assert.deepEqual(await detect('jean@orange.fr'), {
    imap: { host: 'imap.orange.fr', port: 993, security: 'ssl' },
    smtp: { host: 'smtp.orange.fr', port: 465, security: 'ssl' }, provider: 'Orange', source: 'known',
  });
  assert.equal((await detect('Marie@LaPoste.net')).imap.host, 'imap.laposte.net');
  assert.equal((await detect('x@free.fr')).smtp.host, 'smtp.free.fr');
});

test('providers that refuse passwords are reported', async () => {
  assert.deepEqual(await detect('a@outlook.com'), { note: 'microsoft' });
  assert.deepEqual(await detect('a@proton.me'), { note: 'proton' });
});

test('autoconfig files (Thunderbird format)', () => {
  const xml = `<clientConfig version="1.1"><emailProvider id="ex">
    <incomingServer type="pop3"><hostname>pop.ex.fr</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
    <incomingServer type="imap"><hostname>imap.ex.fr</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.ex.fr</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
  </emailProvider></clientConfig>`;
  assert.deepEqual(parseAutoconfig(xml), {
    imap: { host: 'imap.ex.fr', port: 993, security: 'ssl' },
    smtp: { host: 'smtp.ex.fr', port: 587, security: 'starttls' }, userIsLocalPart: true,
  });
  assert.equal(parseAutoconfig('<clientConfig/>'), null);
});
