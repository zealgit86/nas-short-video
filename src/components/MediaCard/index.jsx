// Dependencies
import { useCallback, useRef } from "react";

// Assets
import "./index.css";

const MediaCard = ({
  refForwarder,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onContextMenu,
}) => {
  const cardRef = useRef(null);

  const forward = useCallback((_ref) => {
    cardRef.current = _ref;
    refForwarder(_ref);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="media"
      ref={forward}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
    >
      <video
        className="player media-video"
        playsInline={true}
        preload="metadata"
        hidden
      />
      <img className="player media-image" alt="" hidden />
    </div>
  );
};

export default MediaCard;
