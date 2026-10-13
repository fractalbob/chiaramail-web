import { useMemo } from 'react';
import { isRich, displayHtml } from '../richtext.js';
import PlainBody from './PlainBody.jsx';

// An ECS body as its reader sees it: formatted if it was written with formatting,
// plain text (with web addresses made into links) otherwise.
export default function RichBody({ body }) {
  const html = useMemo(() => (isRich(body) ? displayHtml(body) : null), [body]);
  if (html === null) return <PlainBody text={body} />;
  return <div className="plainbody richbody" dangerouslySetInnerHTML={{ __html: html }} />;
}
