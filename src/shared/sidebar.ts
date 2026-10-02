import type { SidebarLayout, SidebarSectionId } from './contracts';
import { expectRecord, expectBoolean } from './validation';

export const defaultSidebarLayout: SidebarLayout = {
  panel: 'projects',
  hidden: false,
  sections: ['projects', 'recent'],
  hiddenSections: [],
  collapsedSections: [],
};

export function expectSidebarLayout(input: unknown): SidebarLayout {
  const value = expectRecord(input, 'sidebar layout');
  if (!['projects', 'chats', 'archive'].includes(value.panel as string))
    throw new Error('Invalid sidebar panel');
  const sectionList = (inputList: unknown): SidebarSectionId[] => {
    if (
      !Array.isArray(inputList) ||
      inputList.length > 2 ||
      inputList.some((id) => id !== 'projects' && id !== 'recent') ||
      new Set(inputList).size !== inputList.length
    )
      throw new Error('Invalid sidebar sections');
    return [...inputList];
  };
  const sections = sectionList(value.sections);
  if (sections.length !== 2)
    throw new Error('Sidebar order must include every section');
  return {
    panel: value.panel as SidebarLayout['panel'],
    hidden: expectBoolean(value.hidden, 'sidebar visibility'),
    sections,
    hiddenSections: sectionList(value.hiddenSections),
    collapsedSections: sectionList(value.collapsedSections),
  };
}

export function readSidebarLayout(input: unknown): SidebarLayout {
  try {
    return expectSidebarLayout(input);
  } catch {
    return {
      ...defaultSidebarLayout,
      sections: [...defaultSidebarLayout.sections],
      hiddenSections: [],
      collapsedSections: [],
    };
  }
}

export function moveSidebarSection(
  layout: SidebarLayout,
  source: SidebarSectionId,
  target: SidebarSectionId,
): SidebarLayout {
  if (source === target) return layout;
  const sections = [...layout.sections];
  const from = sections.indexOf(source);
  const to = sections.indexOf(target);
  sections.splice(from, 1);
  sections.splice(to, 0, source);
  return { ...layout, sections };
}
