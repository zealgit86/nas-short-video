// Assets
import "./index.css";
import { VideoDate } from "../PeopleManager";

const BottomMetadata = ({ video, extraMetadata, person, onOpenPerson }) => {
  const prefix = video.type === "image" ? "image" : "video";
  const titleField = `${prefix}_title`;
  const captionField = `${prefix}_caption`;
  const linkField = `${prefix}_link`;
  const _metadata = {
    channel_image: extraMetadata && extraMetadata.channel_image,
    channel_name: extraMetadata && extraMetadata.channel_name,
    [titleField]:
      (extraMetadata && extraMetadata[titleField]) || video.title,
    [captionField]: extraMetadata && extraMetadata[captionField],
    [linkField]: extraMetadata && extraMetadata[linkField],
  };
  const folders = video.playlist.split("/");
  const source = [folders.at(-2), folders.at(-1)].filter((part) => part && !/^\d{4}-\d{2}-\d{2}$/.test(part)).join(" · ");

  const handleClick = () => {
    if (!_metadata[linkField]) return;
    window.open(_metadata[linkField], "_blank").focus();
  };

  return (
    <div className="bottom-metadata">
      <button type="button" className="video-author" onClick={onOpenPerson}>
        @{person?.name || _metadata.channel_name || "我的视频"}
      </button>
      {_metadata[captionField] && (
        <div
          className="video-caption"
          dangerouslySetInnerHTML={{ __html: _metadata[captionField] }}
        ></div>
      )}
      <div className="video-title" onClick={handleClick}>
        <p>{_metadata[titleField]}</p>
      </div>
      <div className="video-source"><VideoDate key={video.url} video={video} className="video-date" />{source && <span> · {source}</span>}</div>
    </div>
  );
};

export default BottomMetadata;
