import { useLayoutEffect, useRef } from "react";
import VideoThumbnail from "../PeopleManager/VideoThumbnail";
import restoreGalleryPosition from "../PeopleManager/restoreGalleryPosition";
import { VideoDate } from "../PeopleManager";
import { videoId } from "../../peopleStore";
import "../PeopleManager/index.css";

const FavoritesGallery = ({ videos, onPlay, returnPosition }) => {
  const galleryRef = useRef(null);
  useLayoutEffect(() => {
    restoreGalleryPosition(galleryRef.current, returnPosition.videoId, returnPosition.scrollTop);
  }, [returnPosition]);
  return (
  <section ref={galleryRef} className="favorites-gallery" aria-label="收藏视频缩略图">
    <div className="favorites-gallery-heading"><strong>我的收藏</strong><span>{videos.length} 个视频</span></div>
    <div className="person-grid">
      {videos.map((video, index) => <div className="person-grid-item" key={videoId(video)} data-video-id={videoId(video)}>
        <button type="button" className="person-grid-play" onClick={() => onPlay(video, galleryRef.current.scrollTop)} aria-label={`播放收藏视频 ${index + 1}`}>
          <VideoThumbnail video={video} />
          <VideoDate video={video} />
        </button>
      </div>)}
    </div>
  </section>
  );
};
export default FavoritesGallery;
