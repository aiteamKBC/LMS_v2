import { useState, useRef, useEffect, useCallback } from 'react';

interface FloatingFabProps {
  onClick: () => void;
  icon: string;
  tooltip?: string;
}

export default function FloatingFab({ onClick, icon, tooltip }: FloatingFabProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStart.current = {
      x: clientX,
      y: clientY,
      posX: position.x,
      posY: position.y,
    };
    setIsDragging(true);
    setShowTooltip(false);
  }, [position.x, position.y]);

  const handleMouseMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;
    setPosition({
      x: dragStart.current.posX + deltaX,
      y: dragStart.current.posY + deltaY,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleMouseMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
    return undefined;
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleClick = (e: React.MouseEvent) => {
    // Only trigger click if not dragging
    if (!isDragging) {
      onClick();
    }
  };

  return (
    <div
      ref={dragRef}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
      onClick={handleClick}
      onMouseEnter={() => !isDragging && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      className="fixed z-[90] bottom-6 right-6 select-none touch-none"
    >
      {/* Tooltip */}
      {tooltip && showTooltip && !isDragging && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-foreground-900 text-white text-xs rounded-md whitespace-nowrap animate-in fade-in duration-200">
          {tooltip}
        </div>
      )}

      {/* FAB */}
      <div className="w-12 h-12 rounded-full bg-primary-500 hover:bg-primary-600 text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all duration-200 active:scale-95">
        <AppIcon className={`${icon} text-lg`}></AppIcon>
      </div>

      {/* Drag hint - subtle dots on edges */}
      <div className="absolute inset-0 rounded-full ring-2 ring-primary-300/0 hover:ring-primary-300/40 transition-all duration-200 pointer-events-none" />
    </div>
  );
}