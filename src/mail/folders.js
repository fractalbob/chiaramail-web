// Folder keys used in URLs, mapped to Gmail label IDs (Gmail's order).
export const FOLDERS = [
  { key: 'inbox', label: 'INBOX' },
  { key: 'starred', label: 'STARRED' },
  { key: 'important', label: 'IMPORTANT' },
  { key: 'sent', label: 'SENT' },
  { key: 'drafts', label: 'DRAFT' },
  { key: 'all', label: null },
  { key: 'spam', label: 'SPAM' },
  { key: 'trash', label: 'TRASH' },
];
// Gmail's inbox categories; only those the account actually has are shown.
export const CATEGORIES = [
  { key: 'purchases', label: 'CATEGORY_PURCHASES' },
  { key: 'social', label: 'CATEGORY_SOCIAL' },
  { key: 'updates', label: 'CATEGORY_UPDATES' },
  { key: 'forums', label: 'CATEGORY_FORUMS' },
  { key: 'promotions', label: 'CATEGORY_PROMOTIONS' },
];
const BUILT_IN = [...FOLDERS, ...CATEGORIES];
export const labelIdFor = (folder) => {
  const f = BUILT_IN.find((x) => x.key === folder);
  return f ? f.label : folder; // user labels use their Gmail ID as the key
};
export const isSystemFolder = (folder) => BUILT_IN.some((x) => x.key === folder);

/** User labels as Gmail shows them: "Work/Projects" is a child of "Work". */
export function labelTree(labels) {
  const root = { children: [] };
  for (const l of labels) {
    let node = root;
    const parts = l.name.split('/');
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = node.children.find((c) => c.path === path);
      if (!next) { next = { name: part, path, children: [] }; node.children.push(next); }
      node = next;
    });
    node.label = l;
  }
  const sort = (n) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}
