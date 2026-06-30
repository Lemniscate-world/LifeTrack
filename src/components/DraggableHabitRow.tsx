// src/components/DraggableHabitRow.tsx
// Wrapper that makes a habit row draggable via @hello-pangea/dnd.
// Pure presentation: receives the row JSX as children and the drag index.

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
          {...provided.dragHandleProps}
          className={snapshot.isDragging ? 'habit-row-dragging' : ''}
          style={{
            ...provided.draggableProps.style,
            // Lift the dragged row visually above the rest of the table.
            zIndex: snapshot.isDragging ? 10 : 'auto',
          }}
        >
          {children}
        </tr>
      )}
    </Draggable>
  );
}