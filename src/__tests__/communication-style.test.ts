import {
  appendPiDesktopCommunicationStyle,
  PI_DESKTOP_COMMUNICATION_STYLE,
} from '../utility/communication-style';

describe('Crust communication style', () => {
  it('appends the style without replacing or mutating existing prompt sources', () => {
    const existing = ['Existing user prompt'];

    const appended = appendPiDesktopCommunicationStyle(existing);

    expect(existing).toEqual(['Existing user prompt']);
    expect(appended).toEqual([
      'Existing user prompt',
      PI_DESKTOP_COMMUNICATION_STYLE,
    ]);
  });

  it('encodes terse chat behavior while retaining room for complex answers', () => {
    expect(PI_DESKTOP_COMMUNICATION_STYLE).toContain(
      'Most replies should be 1–3 sentences.',
    );
    expect(PI_DESKTOP_COMMUNICATION_STYLE).toContain(
      'Do not narrate routine work',
    );
    expect(PI_DESKTOP_COMMUNICATION_STYLE).toContain(
      'For genuinely complicated decisions, write more',
    );
    expect(PI_DESKTOP_COMMUNICATION_STYLE).toContain(
      'do not produce an exhaustive design document',
    );
    expect(PI_DESKTOP_COMMUNICATION_STYLE).toContain(
      'keep even a complex first answer under about 400 words',
    );
    expect(PI_DESKTOP_COMMUNICATION_STYLE).toContain(
      'If it looks like a memo, report, specification, or implementation log',
    );
  });
});
