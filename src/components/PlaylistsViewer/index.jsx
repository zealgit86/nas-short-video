// Assets
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "./index.css";
import { faAngleRight, faClose } from "@fortawesome/free-solid-svg-icons";

const PlaylistsViewer = ({ visible, playlists, onClose, onOpenPlaylistGallery, onRefreshIndex, indexRefreshing, indexMessage, onUpload }) => {
  return (
    <div className={`playlists-viewer ${visible ? "visible" : ""}`}>
      <div className="playlists-viewer-inner">
        <div className="playlists-viewer-header">
          <span>视频目录</span>
          <button type="button" className="index-refresh-button" onClick={onRefreshIndex} disabled={indexRefreshing}>{indexRefreshing ? "正在扫描…" : "刷新索引"}</button>
        </div>
        {indexMessage && <div className="index-refresh-status" role="status">{indexMessage}</div>}
        <div className="playlists-viewer-content">
          <button type="button" className="directory-upload" onClick={onUpload}>＋ 上传视频到人物</button>
          <a className="playlists-viewer-entry" href={`/`}>
            <div className="left">
              <p>全部视频</p>
            </div>
          </a>
          {/* FULL STATE */}
          {visible && playlists &&
            playlists.map((p, idx) => (
              <div key={idx} className="playlists-viewer-entry">
                <a className="left" href={`/${encodeURI(p.name)}`}>
                  <p>
                    {!p.metadata || (p.metadata && !p.metadata.channel_name)
                      ? p.name
                      : p.metadata.channel_name}
                  </p>
                </a>
                <div className="right">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenPlaylistGallery(p);
                    }}
                  >
                    <FontAwesomeIcon icon={faAngleRight} />
                  </button>
                </div>
              </div>
            ))}
        </div>
        <div className="playlists-viewer-controls">
          <button type="button" aria-label="关闭视频目录" onClick={onClose}>
            <FontAwesomeIcon icon={faClose} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlaylistsViewer;
