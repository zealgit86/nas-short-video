import { useEffect, useRef, useState } from "react";
import { formatDuration, formatFileSize } from "../../videoInfo";
import { videoId } from "../../peopleStore";

const VideoThumbnail = ({ video }) => {
  const root = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [info, setInfo] = useState(null);
  const [infoFailed, setInfoFailed] = useState(false);

  useEffect(() => {
    setVisible(false);
    setFailed(false);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [video]);

  useEffect(() => {
    setInfo(null);
    setInfoFailed(false);
    if (!visible || video.type === "image") return undefined;
    const controller = new AbortController();
    const hash = new URL(video.url).searchParams.get("hash") || "";
    fetch(`${window.PUBLIC_URL}/api/info?video=${encodeURIComponent(videoId(video))}&hash=${encodeURIComponent(hash)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("info_failed"); return response.json(); })
      .then(setInfo)
      .catch((error) => { if (error.name !== "AbortError") setInfoFailed(true); });
    return () => controller.abort();
  }, [visible, video]);

  const hash = new URL(video.url).searchParams.get("hash") || "";
  const thumbnailUrl = `${window.PUBLIC_URL}/api/thumb?video=${encodeURIComponent(videoId(video))}&hash=${encodeURIComponent(hash)}`;
  const source = video.type === "image" ? video.url : thumbnailUrl;

  return (
    <span className="person-thumbnail" ref={root}>
      {visible && !failed ? (
        <img src={source} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="person-thumbnail-placeholder">{failed ? "无封面" : "▶"}</span>
      )}
      {visible && video.type !== "image" && <span className="person-video-info">
        <span>{info ? formatDuration(info.duration) : infoFailed ? "时长未知" : "读取中…"}</span>
        <span>{info ? formatFileSize(info.size) : ""}</span>
      </span>}
    </span>
  );
};

export default VideoThumbnail;
