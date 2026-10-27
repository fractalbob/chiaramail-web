// ECS by default. Where Outlook runs the add-in by itself (installed by an
// organisation's administrator), every new message starts as an ECS message and
// is converted when Send is pressed; the task pane's checkbox turns that off for
// one message, and its setting changes the default for new ones.
import * as office from './office.js';

const AUTO = 'chiaramail.auto'; // set by the add-in when it opens with a new message
const ECS = 'chiaramail.ecs';   // '1' or '0': send this message as an ECS message
const FWD = 'chiaramail.fwd';   // '1' or '0': its recipients may forward it
const DEFAULT = 'ecsDefault';   // roaming setting; ECS unless turned off

export const BAR = 'chiaramail';

/** ECS for new messages unless the person turned it off. */
export const ecsByDefault = () => office.getSetting(DEFAULT) !== false;
export const setEcsByDefault = (on) => office.setSetting(DEFAULT, !!on);

/** True when Outlook opened the add-in by itself for this message (send handler active). */
export const autoActive = async () => (await office.getSession(AUTO)) === '1';
export const markAuto = () => office.setSession(AUTO, '1');

export async function wantsEcs() {
  const v = await office.getSession(ECS);
  return v === null ? ecsByDefault() : v === '1';
}
export const setWantsEcs = (on) => office.setSession(ECS, on ? '1' : '0');
export const allowsForward = async () => (await office.getSession(FWD)) === '1';
export const setAllowsForward = (on) => office.setSession(FWD, on ? '1' : '0');

/** Shows or hides the bar saying this message will be sent as an ECS message. */
export const showEcsBar = (t, on) => (on ? office.showBar(BAR, t('ol_bar')) : office.hideBar(BAR));
