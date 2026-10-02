import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatAttachment } from '../shared/contracts';
import { expectPath, expectRecord, expectString } from '../shared/validation';
import { imageMimeType, MAX_ATTACHMENT_BYTES } from '../shared/attachments';

export async function prepareAttachment(
  input: unknown,
  storageDirectory: string,
): Promise<ChatAttachment> {
  const value = expectRecord(input);
  let filePath: string;
  if (value.path) {
    filePath = expectPath(value.path);
    if (!path.isAbsolute(filePath))
      throw new Error('Attachment path must be absolute');
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Attach files, not folders');
    if (info.size > MAX_ATTACHMENT_BYTES)
      throw new Error('Files must be 20 MB or smaller');
  } else {
    const name = path.basename(
      expectString(value.name, 'file name', { max: 255 }),
    );
    if (name === '.' || name === '..') throw new Error('Invalid file name');
    if (!(value.bytes instanceof Uint8Array) || !value.bytes.length)
      throw new Error('Clipboard file is empty');
    if (value.bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error('Files must be 20 MB or smaller');
    // Clipboard files need durable paths: Pi may read them again after a session reload.
    const directory = path.join(storageDirectory, randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    filePath = path.join(
      directory,
      name.replace(/[^a-zA-Z0-9._ -]/g, '_') || 'attachment',
    );
    await writeFile(filePath, value.bytes, { flag: 'wx', mode: 0o600 });
  }
  const mimeType = imageMimeType(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    ...(mimeType
      ? {
          preview: `data:${mimeType};base64,${(await readFile(filePath)).toString('base64')}`,
        }
      : {}),
  };
}
