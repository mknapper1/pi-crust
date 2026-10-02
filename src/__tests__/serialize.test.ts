import { safeDisplayValue, serializeMessage } from '../utility/serialize';

describe('Pi message serialization', () => {
  it('keeps provider failures even when the assistant has no text', () => {
    expect(
      serializeMessage(
        {
          role: 'assistant',
          content: [],
          timestamp: 42,
          stopReason: 'error',
          errorMessage: 'Provider authentication failed',
        },
        3,
      ),
    ).toEqual(
      expect.objectContaining({
        id: 'assistant-42-3',
        status: 'failed',
        error: 'Provider authentication failed',
      }),
    );
  });

  it('redacts credential-shaped fields in tool activity', () => {
    expect(
      safeDisplayValue({ apiKey: 'secret-value', command: 'npm test' }),
    ).toContain('"apiKey": "[redacted]"');
  });
});
