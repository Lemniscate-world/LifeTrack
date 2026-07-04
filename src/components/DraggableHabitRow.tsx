// src/components/DraggableHabitRow.tsx
// Wrapper that makes a habit row draggable via @hello-pangea/dnd.
// Pure presentation: receives the row JSX as children and the drag index.
//
// We intentionally do NOT spread dragHandleProps — the library auto-blocks
// drag from interactive children (buttons, inputs) when no handle is set.
// The whole row acts as the drag area. zIndex is also removed because it
// has no effect on display:table-row elements.

import { type PropsWithChildren } from 'react';
import { Draggable } from '@hello-pangea/dnd';

interface Props {
  habitId: string;
  index: number;
}

export function DraggableHabitRow({ habitId, index, children }: PropsWithChildren<Props>) {
  return (
    <Draggable draggableId={habitId} index={index}>
      {(provided, snapshot) => (
        <tr
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={snapshot.isDragging ? 'habit-row-dragging' : ''}
          style={provided.draggableProps.style}
        >
          {children}
        </tr>
      )}
    </Draggable>
  );
}