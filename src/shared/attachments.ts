import { expectPath } from './validation';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function imageMimeType(filePath: string): string | undefined {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    } as Record<string, string>
  )[extension];
}

export function expectAttachmentPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error('Attach up to 20 files per message');
  return value.map((entry) => expectPath(entry));
}
