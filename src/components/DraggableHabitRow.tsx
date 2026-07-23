// src/components/DraggableHabitRow.tsx
// Wrapper that makes a habit row draggable via @hello-pangea/dnd.
// The entire row acts as the drag area (no separate drag handle needed).
// We merge draggableProps with our own className/style to avoid overriding
// critical DnD attributes that @hello-pangea/dnd v18 requires.

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
          className={snapshot.isDragging ? 'habit-row-dragging' : undefined}
        >
          {children}
        </tr>
      )}
    </Draggable>
  );
}