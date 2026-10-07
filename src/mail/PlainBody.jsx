import { toParagraphs } from '../lib.js';

export default function PlainBody({ text }) {
  return (
    <div className="plainbody">
      {toParagraphs(text || '').map((parts, i) => (
        <p key={i}>{parts.map((p, j) => (p.href
          ? <a key={j} href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.href}</a>
          : <span key={j}>{p.text}</span>))}</p>
      ))}
    </div>
  );
}

