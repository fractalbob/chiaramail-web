// Folder keys used in URLs, mapped to Gmail label IDs.
export const FOLDERS = [
  { key: 'inbox', label: 'INBOX' },
  { key: 'starred', label: 'STARRED' },
  { key: 'sent', label: 'SENT' },
  { key: 'all', label: null },
  { key: 'spam', label: 'SPAM' },
  { key: 'trash', label: 'TRASH' },
];
export const labelIdFor = (folder) => {
  const f = FOLDERS.find((x) => x.key === folder);
  return f ? f.label : folder; // user labels use their Gmail ID as the key
};
export const isSystemFolder = (folder) => FOLDERS.some((x) => x.key === folder);
