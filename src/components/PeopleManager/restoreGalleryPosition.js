// Restore the list itself, keeping an already visible thumbnail in place.
export default function restoreGalleryPosition(container, videoId, scrollTop) {
  if (!container) return;
  if (scrollTop !== undefined) container.scrollTop = scrollTop;
  if (!videoId) return;
  const tile = Array.from(container.querySelectorAll('[data-video-id]'))
    .find((item) => item.dataset.videoId === videoId);
  if (!tile) return;
  const viewport = container.getBoundingClientRect();
  const bounds = tile.getBoundingClientRect();
  if (bounds.top < viewport.top) container.scrollTop += bounds.top - viewport.top;
  else if (bounds.bottom > viewport.bottom) container.scrollTop += bounds.bottom - viewport.bottom;
}
