// Gmail-style letter avatar: the first letter of the name, on a colour picked from the address.
const HUES = [4, 28, 45, 95, 145, 175, 200, 225, 260, 290, 320, 345];
export const hue = (str) => HUES[[...(str || '?')].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % HUES.length];
export const initial = (name) => (name || '').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?';
