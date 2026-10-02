/** @jest-environment node */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareAttachment } from '../main/attachments';
import { attachmentPrompt } from '../utility/attachment-prompt';
import {
  expectAttachmentPaths,
  MAX_ATTACHMENT_BYTES,
} from '../shared/attachments';
import { serializeMessage } from '../utility/serialize';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'pi-attachments-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('keeps dropped native files at their original paths', async () => {
  const filePath = path.join(directory, 'a document.txt');
  await writeFile(filePath, 'Hello');
  const attachment = await prepareAttachment({ path: filePath }, directory);
  expect(attachment).toEqual({ path: filePath, name: 'a document.txt' });
  const prompt = await attachmentPrompt('Read this', [attachment.path]);
  expect(prompt.text).toContain(JSON.stringify(filePath));
  expect(prompt.images).toEqual([]);
});

it('saves pasted images durably, sends native image content, and preserves previews in history', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const attachment = await prepareAttachment(
    { name: 'image.png', bytes },
    directory,
  );
  expect(await readFile(attachment.path)).toEqual(Buffer.from(bytes));
  expect(attachment.preview).toBe('data:image/png;base64,iVBORw==');
  const prompt = await attachmentPrompt('', [attachment.path]);
  expect(prompt.images).toEqual([
    { type: 'image', mimeType: 'image/png', data: 'iVBORw==' },
  ]);
  expect(prompt.text).toContain(attachment.path);
  expect(
    serializeMessage(
      {
        role: 'user',
        content: [{ type: 'text', text: prompt.text }, ...prompt.images],
      },
      0,
    )?.images,
  ).toEqual([{ mimeType: 'image/png', data: 'iVBORw==' }]);
});

it('supports multiple files and does not treat PDFs as images', async () => {
  const attachments = await Promise.all(
    ['notes.txt', 'report.pdf'].map((name) =>
      prepareAttachment({ name, bytes: new Uint8Array([65]) }, directory),
    ),
  );
  const prompt = await attachmentPrompt(
    'Compare these',
    attachments.map((entry) => entry.path),
  );
  expect(prompt.text).toContain('notes.txt');
  expect(prompt.text).toContain('report.pdf');
  expect(prompt.images).toEqual([]);
});

it('rejects folders, missing files, oversized clipboard files, traversal names and malformed attachment lists', async () => {
  await expect(
    prepareAttachment({ path: directory }, directory),
  ).rejects.toThrow('not folders');
  await expect(
    prepareAttachment({ path: path.join(directory, 'missing') }, directory),
  ).rejects.toThrow();
  await expect(
    prepareAttachment(
      { name: 'big.txt', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) },
      directory,
    ),
  ).rejects.toThrow('20 MB');
  await expect(
    prepareAttachment({ name: '..', bytes: new Uint8Array([1]) }, directory),
  ).rejects.toThrow('Invalid file name');
  expect(() => expectAttachmentPaths(Array(21).fill('/tmp/file'))).toThrow(
    '20 files',
  );
  expect(() => expectAttachmentPaths([42])).toThrow();
});

it('keeps ordinary text prompts unchanged', async () => {
  expect(await attachmentPrompt('Hello', [])).toEqual({
    text: 'Hello',
    images: [],
  });
});
