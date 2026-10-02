import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaretRight,
  DotsSixVertical,
  SlidersHorizontal,
} from '@phosphor-icons/react';
import type { SidebarLayout, SidebarSectionId } from '../shared/contracts';
import { defaultSidebarLayout, moveSidebarSection } from '../shared/sidebar';

const labels = { projects: 'Projects', recent: 'Recent chats' };
export default function SidebarSections({
  layout,
  onChange,
  disabled,
  content,
}: {
  layout: SidebarLayout;
  onChange: (layout: SidebarLayout) => void;
  disabled: boolean;
  content: Record<SidebarSectionId, ReactNode>;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [dragging, setDragging] = useState<SidebarSectionId>();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!customizing) return undefined;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        setCustomizing(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toggleRef.current?.focus();
        setCustomizing(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [customizing]);
  const toggleList = (
    key: 'hiddenSections' | 'collapsedSections',
    id: SidebarSectionId,
  ) =>
    onChange({
      ...layout,
      [key]: layout[key].includes(id)
        ? layout[key].filter((entry) => entry !== id)
        : [...layout[key], id],
    });
  return (
    <>
      <div className="sidebar-panel-heading" ref={rootRef}>
        <span>{layout.panel === 'projects' ? 'Workspace' : 'Chats'}</span>
        <button
          type="button"
          className="icon-button"
          ref={toggleRef}
          aria-label="Customize sidebar"
          aria-expanded={customizing}
          onClick={() => setCustomizing(!customizing)}
        >
          <SlidersHorizontal size={16} />
        </button>
        {customizing && (
          <div
            className="sidebar-customize"
            role="region"
            aria-label="Sidebar customization"
          >
            <strong>Sidebar sections</strong>
            {layout.sections.map((id, index) => (
              <div className="sidebar-customize-row" key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!layout.hiddenSections.includes(id)}
                    disabled={disabled}
                    onChange={() => toggleList('hiddenSections', id)}
                  />
                  {labels[id]}
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${labels[id]} up`}
                  disabled={disabled || index === 0}
                  onClick={() =>
                    onChange(
                      moveSidebarSection(
                        layout,
                        id,
                        layout.sections[index - 1],
                      ),
                    )
                  }
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${labels[id]} down`}
                  disabled={disabled || index === layout.sections.length - 1}
                  onClick={() =>
                    onChange(
                      moveSidebarSection(
                        layout,
                        id,
                        layout.sections[index + 1],
                      ),
                    )
                  }
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            ))}
            <p>
              Drag section handles to reorder. Collapse sections with their
              chevrons.
            </p>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => onChange(defaultSidebarLayout)}
            >
              Reset sidebar layout
            </button>
          </div>
        )}
      </div>
      <div className="sidebar-scroll">
        {layout.sections
          .filter(
            (id) =>
              !layout.hiddenSections.includes(id) &&
              (layout.panel !== 'chats' || id === 'recent'),
          )
          .map((id) => {
            const collapsed = layout.collapsedSections.includes(id);
            return (
              <section
                className={`sidebar-view-section ${dragging && dragging !== id ? 'is-drop-target' : ''}`}
                key={id}
                onDragOver={(event) => {
                  if (
                    !disabled &&
                    event.dataTransfer.types.includes(
                      'application/x-pi-sidebar-section',
                    )
                  )
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  const source = event.dataTransfer.getData(
                    'application/x-pi-sidebar-section',
                  );
                  if (
                    disabled ||
                    (source !== 'projects' && source !== 'recent')
                  )
                    return;
                  event.preventDefault();
                  setDragging(undefined);
                  onChange(moveSidebarSection(layout, source, id));
                }}
              >
                <div className="sidebar-view-heading">
                  <button
                    type="button"
                    className="sidebar-section-toggle"
                    disabled={disabled}
                    aria-expanded={!collapsed}
                    onClick={() => toggleList('collapsedSections', id)}
                  >
                    <CaretRight
                      size={12}
                      className={collapsed ? '' : 'project-caret-open'}
                    />
                    <span>{labels[id]}</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-drag-handle"
                    draggable={!disabled}
                    disabled={disabled}
                    aria-label={`Reorder ${labels[id]}`}
                    title="Drag to reorder · Alt+↑/↓"
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        'application/x-pi-sidebar-section',
                        id,
                      );
                      event.dataTransfer.effectAllowed = 'move';
                      setDragging(id);
                    }}
                    onDragEnd={() => setDragging(undefined)}
                    onKeyDown={(event) => {
                      if (
                        !event.altKey ||
                        !['ArrowUp', 'ArrowDown'].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const index = layout.sections.indexOf(id);
                      const target =
                        layout.sections[
                          index + (event.key === 'ArrowUp' ? -1 : 1)
                        ];
                      if (target)
                        onChange(moveSidebarSection(layout, id, target));
                    }}
                  >
                    <DotsSixVertical size={14} />
                  </button>
                </div>
                {!collapsed && content[id]}
              </section>
            );
          })}
        {(layout.panel === 'chats'
          ? layout.hiddenSections.includes('recent')
          : layout.hiddenSections.length === 2) && (
          <p className="sidebar-empty">
            All sections hidden. Use Customize sidebar to restore them.
          </p>
        )}
      </div>
    </>
  );
}
