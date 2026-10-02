import { fireEvent, render, screen } from '@testing-library/react';
import SidebarSections from '../renderer/SidebarSections';
import {
  defaultSidebarLayout,
  expectSidebarLayout,
  moveSidebarSection,
  readSidebarLayout,
} from '../shared/sidebar';

it('migrates older preferences and rejects malformed layout updates', () => {
  expect(readSidebarLayout(undefined)).toEqual(defaultSidebarLayout);
  expect(readSidebarLayout({ sections: ['unknown'] })).toEqual(
    defaultSidebarLayout,
  );
  expect(() =>
    expectSidebarLayout({
      ...defaultSidebarLayout,
      sections: ['projects', 'projects'],
    }),
  ).toThrow();
  expect(() =>
    expectSidebarLayout({ ...defaultSidebarLayout, panel: 'unknown' }),
  ).toThrow();
  expect(
    moveSidebarSection(defaultSidebarLayout, 'recent', 'projects').sections,
  ).toEqual(['recent', 'projects']);
});

it('collapses sections and exposes visibility, keyboard ordering and reset controls', () => {
  const onChange = jest.fn();
  render(
    <SidebarSections
      layout={defaultSidebarLayout}
      disabled={false}
      onChange={onChange}
      content={{ projects: 'Project content', recent: 'Chat content' }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
  expect(onChange).toHaveBeenLastCalledWith({
    ...defaultSidebarLayout,
    collapsedSections: ['projects'],
  });
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Reorder Recent chats' }),
    { key: 'ArrowUp', altKey: true },
  );
  expect(onChange.mock.lastCall[0].sections).toEqual(['recent', 'projects']);
  fireEvent.click(screen.getByRole('button', { name: 'Customize sidebar' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Recent chats' }));
  expect(onChange.mock.lastCall[0].hiddenSections).toEqual(['recent']);
  fireEvent.click(screen.getByRole('button', { name: 'Reset sidebar layout' }));
  expect(onChange).toHaveBeenLastCalledWith(defaultSidebarLayout);
});

it('shows only recent chats in the Chats view and leaves hidden sections recoverable', () => {
  const { rerender } = render(
    <SidebarSections
      layout={{ ...defaultSidebarLayout, panel: 'chats' }}
      disabled={false}
      onChange={() => {}}
      content={{ projects: 'Project content', recent: 'Chat content' }}
    />,
  );
  expect(screen.queryByText('Project content')).toBeNull();
  expect(screen.getByText('Chat content')).toBeTruthy();
  rerender(
    <SidebarSections
      layout={{
        ...defaultSidebarLayout,
        hiddenSections: ['projects', 'recent'],
      }}
      disabled={false}
      onChange={() => {}}
      content={{ projects: 'Project content', recent: 'Chat content' }}
    />,
  );
  expect(screen.getByText(/All sections hidden/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Customize sidebar' }),
  ).toBeTruthy();
});

it('accepts section drops without handling dropped chat files', () => {
  const onChange = jest.fn();
  render(
    <SidebarSections
      layout={defaultSidebarLayout}
      disabled={false}
      onChange={onChange}
      content={{ projects: 'Project content', recent: 'Chat content' }}
    />,
  );
  const section = screen
    .getByRole('button', { name: 'Projects' })
    .closest('section')!;
  fireEvent.drop(section, { dataTransfer: { getData: () => 'recent' } });
  expect(onChange.mock.lastCall[0].sections).toEqual(['recent', 'projects']);
  onChange.mockClear();
  fireEvent.drop(section, { dataTransfer: { getData: () => '' } });
  expect(onChange).not.toHaveBeenCalled();
});
