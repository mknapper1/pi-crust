import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelControls from '../renderer/ModelControls';

const models = [
  { provider: 'openai-codex', id: 'gpt-5.5', name: 'GPT-5.5', reasoning: true },
  {
    provider: 'openai-codex',
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    reasoning: true,
  },
  { provider: 'other', id: 'fast', name: 'Fast model', reasoning: false },
];
const props = {
  models,
  selectedModel: models[0],
  thinkingLevel: 'medium' as const,
  thinkingLevels: ['off', 'medium', 'xhigh'] as const,
  disabled: false,
  onModelChange: jest.fn(async () => {}),
  onThinkingChange: jest.fn(async () => {}),
  onError: jest.fn(),
};
const setup = (overrides = {}) =>
  render(
    <ModelControls
      {...props}
      thinkingLevels={[...props.thinkingLevels]}
      {...overrides}
    />,
  );
beforeEach(() => jest.clearAllMocks());

it('opens a searchable provider-grouped model picker and applies a selection', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Model: GPT-5.5' }));
  const search = screen.getByRole('combobox');
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('group')).toHaveLength(2);
  fireEvent.change(search, { target: { value: '6.1' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.click(screen.getByRole('option', { name: 'GPT-6.1 Sol' }));
  await waitFor(() =>
    expect(props.onModelChange).toHaveBeenCalledWith(models[1]),
  );
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
});

it('handles no results, arrow navigation and Escape without changing the model', () => {
  setup();
  const trigger = screen.getByRole('button', { name: 'Model: GPT-5.5' });
  fireEvent.click(trigger);
  const search = screen.getByRole('combobox');
  fireEvent.change(search, { target: { value: 'not-found' } });
  expect(screen.getByText('No matching models')).toBeTruthy();
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(
    screen.getByRole('option', { name: 'GPT-5.5' }),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(props.onModelChange).not.toHaveBeenCalled();
});

it('offers only supported thinking levels, with selection and clear labels', async () => {
  setup();
  fireEvent.click(
    screen.getByRole('button', { name: 'Thinking level: Medium' }),
  );
  expect(screen.getAllByRole('option')).toHaveLength(3);
  const extra = screen.getByRole('option', { name: /Extra high/ });
  fireEvent.click(extra);
  await waitFor(() =>
    expect(props.onThinkingChange).toHaveBeenCalledWith('xhigh'),
  );
});

it('keeps failed changes visible and disables controls during runs', async () => {
  const failure = new Error('Could not switch');
  const { rerender } = setup({
    onModelChange: async () => {
      throw failure;
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Model: GPT-5.5' }));
  fireEvent.click(screen.getByRole('option', { name: 'GPT-6.1 Sol' }));
  await waitFor(() => expect(props.onError).toHaveBeenCalledWith(failure));
  expect(screen.getByRole('combobox')).toBeTruthy();
  rerender(
    <ModelControls
      {...props}
      thinkingLevels={[...props.thinkingLevels]}
      disabled
    />,
  );
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: 'Model: GPT-5.5',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it('hides thinking controls for models without reasoning support', () => {
  setup({ selectedModel: models[2] });
  expect(screen.queryByRole('button', { name: /Thinking level/ })).toBeNull();
});
