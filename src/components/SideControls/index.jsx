// Assets
import "./index.css";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faDownload,
  faHeart,
  faShare,
  faVolumeMute,
  faVolumeUp,
} from "@fortawesome/free-solid-svg-icons";
import { PersonAvatar } from "../PeopleManager";

const SideControls = ({
  onShare,
  onFavorite,
  isFavorite,
  onToggleMute,
  isMuted,
  playbackSpeed,
  onCyclePlaybackSpeed,
  onDelete,
  onDownload,
  person,
  onOpenPerson,
  onAddPerson,
}) => {
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [manualShareURL, setManualShareURL] = useState("");
  const statusTimeout = useRef(null);
  const manualShareInput = useRef(null);

  useEffect(() => {
    if (manualShareURL) {
      manualShareInput.current.focus();
      manualShareInput.current.select();
    }
  }, [manualShareURL]);

  useEffect(
    () => () => {
      clearTimeout(statusTimeout.current);
    },
    [],
  );

  const handleShare = async () => {
    setSharing(true);
    setShareStatus("");
    clearTimeout(statusTimeout.current);

    let result;
    try {
      result = await onShare();
    } catch {
      result = { status: "failed" };
    } finally {
      setSharing(false);
    }

    if (!result || result.status === "cancelled") return;

    if (result.status === "manual-copy") {
      setManualShareURL(result.url);
      return;
    }

    const messages = {
      shared: "已分享",
      copied: "链接已复制",
      failed: "分享失败",
    };
    setShareStatus(messages[result.status] || "分享失败");
    statusTimeout.current = setTimeout(() => setShareStatus(""), 2500);
  };

  const closeManualShare = () => {
    setManualShareURL("");
  };

  return (
    <div className="side-controls">
      <div className="inner">
        {onOpenPerson && (
          <div className="person-side-control">
            <button type="button" className="person-side-avatar" onClick={onOpenPerson} aria-label={person ? `查看${person.name}的视频` : "查看人物"}>
              <PersonAvatar person={person} />
            </button>
            {onAddPerson && <button type="button" className="person-side-add" onClick={onAddPerson} aria-label="添加当前视频到人物">＋</button>}
            <span>人物</span>
          </div>
        )}
        <button
          type="button"
          className={`side-action favorite-action ${isFavorite ? "active" : ""}`}
          aria-label={isFavorite ? "取消收藏" : "收藏视频"}
          aria-pressed={isFavorite}
          onClick={onFavorite}
        >
          <FontAwesomeIcon icon={faHeart} />
          <span>收藏</span>
        </button>
        <button type="button" className="side-action" onClick={handleShare} disabled={sharing} aria-label="分享视频">
          <FontAwesomeIcon icon={faShare} />
          <span>{sharing ? "分享中" : "分享"}</span>
        </button>
        <button type="button" className="side-action" onClick={onToggleMute} aria-label={isMuted ? "开启声音" : "关闭声音"} aria-pressed={!isMuted}>
          <FontAwesomeIcon icon={isMuted ? faVolumeMute : faVolumeUp} />
          <span>声音</span>
        </button>
        <button
          type="button"
          className="side-action speed-action"
          onClick={onCyclePlaybackSpeed}
          aria-label={`当前 ${playbackSpeed} 倍速，点击切换`}
        >
          <strong aria-hidden="true">{playbackSpeed}×</strong>
          <span>倍速</span>
        </button>
        <button type="button" className="side-action" onClick={onDownload} aria-label="下载视频">
          <FontAwesomeIcon icon={faDownload} />
          <span>下载</span>
        </button>
        {onDelete && <button type="button" className="side-action" onClick={onDelete} aria-label="删除 NAS 原视频"><FontAwesomeIcon icon={faTrash} /><span>删除</span></button>}

      </div>

      <div className="share-status" role="status" aria-live="polite">
        {shareStatus}
      </div>

      {manualShareURL && (
        <div className="share-dialog-backdrop">
          <div
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
          >
            <h2 id="share-dialog-title">分享视频</h2>
            <p>复制此链接：</p>
            <input
              ref={manualShareInput}
              type="text"
              readOnly
              value={manualShareURL}
              aria-label="分享链接"
              onFocus={(event) => event.target.select()}
            />
            <button type="button" onClick={closeManualShare}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SideControls;
