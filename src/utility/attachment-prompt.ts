import { readFile, stat } from 'node:fs/promises';
import type { ImageContent } from '@earendil-works/pi-ai/compat';
import { imageMimeType, MAX_ATTACHMENT_BYTES } from '../shared/attachments';

export async function attachmentPrompt(text: string, paths: string[]) {
  const images: ImageContent[] = [];
  for (const filePath of paths) {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Attach files, not folders');
    if (info.size > MAX_ATTACHMENT_BYTES)
      throw new Error('Files must be 20 MB or smaller');
    const mimeType = imageMimeType(filePath);
    if (mimeType)
      images.push({
        type: 'image',
        mimeType,
        data: (await readFile(filePath)).toString('base64'),
      });
  }
  const references = paths.length
    ? `Attached files (use read or other tools as needed):\n${paths.map((filePath) => JSON.stringify(filePath)).join('\n')}`
    : '';
  return {
    text: [text.trim(), references].filter(Boolean).join('\n\n'),
    images,
  };
}
