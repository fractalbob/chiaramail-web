// Where ECS attachments are kept: files on the server's own disk, one folder
// per message (FILES_DIR/<message id>/<slot>). They are already encrypted by
// the sender's app. Back this folder up together with the database.
import { mkdir, rm, rename, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const SAFE_ID = /^[A-Za-z0-9]{20}$/;

export function fileStore(dir) {
  const pathOf = (id, i) => {
    if (!SAFE_ID.test(id) || !Number.isInteger(i) || i < 0 || i > 999) throw new Error('bad file name');
    return join(dir, id, String(i));
  };
  return {
    /** Writes the stream; fails (and keeps nothing) past maxBytes. Returns the size. */
    async put(id, i, stream, maxBytes) {
      const final = pathOf(id, i);
      await mkdir(join(dir, id), { recursive: true });
      const tmp = `${final}.${randomBytes(6).toString('hex')}.part`;
      let n = 0;
      const limit = new Transform({
        transform(chunk, _enc, cb) {
          n += chunk.length;
          if (n > maxBytes) cb(Object.assign(new Error('too big'), { status: 413 }));
          else cb(null, chunk);
        },
      });
      try {
        await pipeline(stream, limit, createWriteStream(tmp));
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
      await rename(tmp, final);
      return n;
    },
    async get(id, i) {
      const p = pathOf(id, i);
      const s = await stat(p).catch(() => null);
      if (!s) return null;
      return { size: s.size, stream: createReadStream(p) };
    },
    async removeAll(id) {
      if (!SAFE_ID.test(id)) return;
      await rm(join(dir, id), { recursive: true, force: true });
    },
  };
}
