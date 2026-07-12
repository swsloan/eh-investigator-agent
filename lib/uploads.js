import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

export function safeUploadName(name) {
  const safe = path.basename(String(name || 'upload')).replace(/[^\w.\-() ]/g, '_').trim();
  if (!safe || safe === '.' || safe === '..') return 'upload';
  return safe.startsWith('.') ? `_${safe.slice(1) || 'upload'}` : safe;
}

export function uniqueUploadName(sessions, sessionId, originalName) {
  const session = sessions.get(sessionId);
  const safe = safeUploadName(originalName);
  if (!session) return safe;
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext) || 'upload';
  let candidate = safe;
  let n = 1;
  while (fs.existsSync(path.join(session.uploadsDir, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

export function validateAttachments(session, attachments = []) {
  if (!Array.isArray(attachments)) {
    const err = new Error('Invalid attachments');
    err.statusCode = 400;
    throw err;
  }
  return attachments.map((attachment) => {
    const name = typeof attachment?.name === 'string' ? attachment.name : '';
    if (!name || path.basename(name) !== name) {
      const err = new Error('Invalid attachment name');
      err.statusCode = 400;
      throw err;
    }
    const abs = session.resolveFile(path.join('uploads', name));
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      const err = new Error(`Attachment not found: ${name}`);
      err.statusCode = 400;
      throw err;
    }
    if (!stat.isFile()) {
      const err = new Error(`Attachment is not a file: ${name}`);
      err.statusCode = 400;
      throw err;
    }
    return { name, size: stat.size };
  });
}

export function createUploadMiddleware(sessions) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const session = sessions.get(req.params.id);
        if (!session) return cb(new Error('Session not found'));
        cb(null, session.uploadsDir);
      },
      filename: (req, file, cb) => {
        // Keep original names (sanitized) so the agent sees meaningful filenames.
        cb(null, uniqueUploadName(sessions, req.params.id, file.originalname));
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });
}
