// src/components/DraggableHabitRow.tsx
// Wrapper that makes a habit row draggable via @hello-pangea/dnd.
// The row is draggable, but only a small grip icon acts as the drag handle
// so buttons (archive, stack, category, etc.) remain fully clickable.

import { type PropsWithChildren } from 'react';
import { Draggable } from '@hello-pangea/dnd';

interface Props {
  habitId: string;
  index: number;
  className?: string;
}

export function DraggableHabitRow({ habitId, index, children, className }: PropsWithChildren<Props>) {
  return (
    <Draggable draggableId={habitId} index={index}>
      {(provided, snapshot) => (
        <tr
          ref={provided.innerRef}
          {...provided.draggableProps}
          style={provided.draggableProps.style}
          className={[snapshot.isDragging ? 'habit-row-dragging' : '', className ?? ''].filter(Boolean).join(' ')}
        >
          <td className="col-drag-handle" {...provided.dragHandleProps} aria-label="Drag to reorder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/>
              <line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="16" y2="18"/>
            </svg>
          </td>
          {children}
        </tr>
      )}
    </Draggable>
  );
}