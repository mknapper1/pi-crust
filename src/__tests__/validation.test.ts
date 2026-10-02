import {
  expectExternalUrl,
  expectPath,
  expectProvider,
  expectSidebarWidth,
} from '../shared/validation';

describe('IPC payload validation', () => {
  it('accepts expected scalar payloads and clamps presentation values', () => {
    expect(expectPath('/tmp/project')).toBe('/tmp/project');
    expect(expectProvider('anthropic')).toBe('anthropic');
    expect(expectSidebarWidth(999)).toBe(420);
  });

  it('rejects malformed or unsafe values', () => {
    expect(() => expectPath('bad\0path')).toThrow('invalid');
    expect(() => expectProvider('../../secret')).toThrow('invalid');
    expect(() => expectExternalUrl('javascript:alert(1)')).toThrow(
      'Only http, https, and mailto',
    );
    expect(() => expectExternalUrl('file:///tmp/secret')).toThrow(
      'Only http, https, and mailto',
    );
  });

  it('only allows explicit external URL schemes', () => {
    expect(expectExternalUrl('https://example.com/docs')).toBe(
      'https://example.com/docs',
    );
    expect(expectExternalUrl('mailto:hello@example.com')).toBe(
      'mailto:hello@example.com',
    );
  });
});
