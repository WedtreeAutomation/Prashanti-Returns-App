import React, { useState, useRef, MouseEvent } from 'react';

interface ImageZoomProps {
  src: string;
  alt: string;
  zoomSize?: number;      // Customizable zoom circle size
  zoomScale?: number;     // Customizable zoom scale
}

export const ImageZoom: React.FC<ImageZoomProps> = ({ 
  src, 
  alt, 
  zoomSize = 240,        // Default 240px
  zoomScale = 350        // Default 3.5x zoom
}) => {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const LENS_OFFSET = zoomSize / 2;

  const handleMouseEnter = () => setShowMagnifier(true);
  const handleMouseLeave = () => setShowMagnifier(false);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!imgRef.current) return;

    const { left, top, width, height } = imgRef.current.getBoundingClientRect();
    
    const x = e.pageX - left - window.scrollX;
    const y = e.pageY - top - window.scrollY;

    setCursorPosition({ x, y });

    if (x < 0 || y < 0 || x > width || y > height) {
      setShowMagnifier(false);
      return;
    }

    const zoomX = (x / width) * 100;
    const zoomY = (y / height) * 100;

    setPosition({ x: zoomX, y: zoomY });
  };

  const getLensStyle = () => {
    if (!imgRef.current) return {};

    const { width, height } = imgRef.current.getBoundingClientRect();
    
    let left = cursorPosition.x - LENS_OFFSET;
    let top = cursorPosition.y - LENS_OFFSET;

    left = Math.max(0, Math.min(left, width - zoomSize));
    top = Math.max(0, Math.min(top, height - zoomSize));

    return {
      left: `${left}px`,
      top: `${top}px`,
    };
  };

  return (
    <div 
      className="relative w-full h-80 rounded-lg overflow-hidden border border-slate-200 cursor-crosshair group bg-white"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      <img 
        ref={imgRef}
        src={src} 
        alt={alt} 
        className="w-full h-full object-contain"
        draggable={false}
      />

      {showMagnifier && (
        <>
          {/* Glass background */}
          <div 
            className="absolute rounded-full pointer-events-none z-40 bg-black/5 backdrop-blur-[2px]"
            style={{
              width: `${zoomSize}px`,
              height: `${zoomSize}px`,
              ...getLensStyle(),
              border: '2px solid rgba(255,255,255,0.8)',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1), 0 8px 30px rgba(0,0,0,0.2)',
            }}
          />
          
          {/* Zoomed image */}
          <div 
            className="absolute rounded-full pointer-events-none z-50 bg-no-repeat"
            style={{
              width: `${zoomSize}px`,
              height: `${zoomSize}px`,
              ...getLensStyle(),
              backgroundImage: `url('${src}')`,
              backgroundPosition: `${position.x}% ${position.y}%`,
              backgroundSize: `${zoomScale}%`,
              border: '3px solid white',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1), 0 8px 30px rgba(0,0,0,0.3)',
            }}
          />
        </>
      )}
    </div>
  );
};