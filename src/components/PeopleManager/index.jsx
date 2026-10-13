import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readAvatarFile, videoId } from "../../peopleStore";
import VideoThumbnail from "./VideoThumbnail";
import restoreGalleryPosition from "./restoreGalleryPosition";
import "./index.css";

export const PersonAvatar = ({ person, size = "normal" }) => {
  const source = person?.avatar || person?.defaultAvatarUrl || "";
  const [failedSource, setFailedSource] = useState("");
  return (
    <span className={`person-avatar ${size}`}>
      {source && failedSource !== source ?
        <img src={source} alt="" loading="lazy" onError={() => setFailedSource(source)} /> :
        <span>{person?.name?.slice(0, 1) || "+"}</span>}
    </span>
  );
};

const directoryDate = (video) => video.playlist?.split("/").reverse()
  .find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));

export const VideoDate = ({ video, className = "person-grid-title" }) => {
  const folderDate = directoryDate(video);
  const [fileDate, setFileDate] = useState("");

  useEffect(() => {
    if (folderDate) return undefined;
    const controller = new AbortController();
    fetch(video.url, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("File date unavailable");
        const modified = new Date(response.headers.get("Last-Modified"));
        if (!Number.isNaN(modified.getTime())) {
          const year = modified.getFullYear();
          const month = String(modified.getMonth() + 1).padStart(2, "0");
          const day = String(modified.getDate()).padStart(2, "0");
          setFileDate(`${year}-${month}-${day}`);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [folderDate, video.url]);

  return <span className={className}>{folderDate || fileDate || "日期未知"}</span>;
};

const PeopleManager = ({ panel, people, assignments, allVideos, currentVideo,
  busy, error, onClose, onList, onProfile, onAssign, onRemove, onTransfer, onCreate, onUpdate, onPlay, returnPosition, onUpload }) => {
  const profileRef = useRef(null);
  const [form, setForm] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [formError, setFormError] = useState("");
  useEffect(() => {
    setPendingTransfer(null);
    setTransferTarget("");
    setPendingRemoval(null);
  }, [panel?.view, panel?.personId]);
  useLayoutEffect(() => {
    if (panel?.view === "profile" && panel.personId === returnPosition?.personId) {
      restoreGalleryPosition(profileRef.current, returnPosition.videoId);
    }
  }, [returnPosition, panel?.view, panel?.personId]);
  if (!panel) return null;

  const profile = people.find((person) => person.id === panel.personId);
  const profileVideos = profile
    ? allVideos.filter((video) => assignments[videoId(video)] === profile.id)
    : [];
  const count = (person) => allVideos.filter((video) => assignments[videoId(video)] === person.id).length;

  const openForm = (person = null) => {
    setForm(person ? person.id : "create");
    setName(person?.name || "");
    setAvatar(person?.avatar || "");
    setFormError("");
  };
  const saveForm = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setFormError("请输入人物名称");
    const ok = form === "create"
      ? await onCreate(trimmed, avatar, panel.view === "picker")
      : await onUpdate(form, trimmed, avatar);
    if (ok) setForm(null);
  };
  const chooseAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setAvatar(await readAvatarFile(file));
      setFormError("");
    } catch (e) { setFormError(e.message); }
    event.target.value = "";
  };
  const removeVideo = async () => {
    if (!pendingRemoval || !profile) return;
    const ok = await onRemove(pendingRemoval, profile.id);
    if (ok) setPendingRemoval(null);
  };

  const transferVideo = async () => {
    if (!pendingTransfer || !transferTarget || busy) return;
    const ok = await onTransfer(pendingTransfer.video, pendingTransfer.fromId, transferTarget);
    if (ok) { setPendingTransfer(null); setTransferTarget(""); }
  };
  return (
    <div className="people-overlay" role="dialog" aria-modal="true" aria-label="人物视频">
      <div className="people-head">
        <button type="button" onClick={panel.view === "profile" ? onList : onClose} aria-label="返回">‹</button>
        <strong>{panel.view === "picker" ? "添加到人物" : panel.view === "profile" ? profile?.name || "人物" : "人物"}</strong>
        <button type="button" onClick={onClose} aria-label="关闭">×</button>
      </div>
      {error && <p className="people-error" role="alert">{error}</p>}
      {panel.view === "profile" && profile ? (
        <div className="people-scroll" ref={profileRef}>
          <div className="person-profile-head">
            <PersonAvatar person={profile} size="large" />
            <div><h2>{profile.name}</h2><p>{profileVideos.length} 个视频</p></div>
            <button type="button" onClick={() => openForm(profile)}>编辑</button>
          </div>
          <button type="button" className="people-create" onClick={() => onUpload(profile.id)}>＋ 上传视频到这个人物</button>
          {profileVideos.length ? (
            <div className="person-grid">
              {profileVideos.map((video) => (
                <div className="person-grid-item" key={videoId(video)} data-video-id={videoId(video)}>
                  <button type="button" className="person-grid-play" onClick={() => onPlay(profile, video, profileVideos)} aria-label={`播放 ${directoryDate(video) || "视频"}`}>
                    <VideoThumbnail video={video} />
                    <VideoDate video={video} />
                  </button>
                  <button type="button" className="person-grid-transfer" disabled={busy}
                    onClick={() => { setTransferTarget(""); setPendingTransfer({ video, fromId: profile.id, fromName: profile.name }); }} aria-label="将此视频转移到其他人物">转移</button>
                  <button type="button" className="person-grid-remove" disabled={busy}
                    onClick={() => setPendingRemoval(video)} aria-label="将此视频移出人物">移出</button>
                </div>
              ))}
            </div>
          ) : <p className="people-empty">这个人物还没有视频。刷到视频时点头像旁的＋即可添加。</p>}
        </div>
      ) : (
        <div className="people-scroll">
          {panel.view === "picker" && currentVideo && (
            <p className="people-tip">当前视频：{currentVideo.title}</p>
          )}
          <button type="button" className="people-create" onClick={() => openForm()}>＋ 新建人物</button>
          {people.length ? people.map((person) => (
            <button type="button" className="people-row" key={person.id} disabled={busy}
              onClick={() => panel.view === "picker" ? onAssign(person.id) : onProfile(person.id)}>
              <PersonAvatar person={person} />
              <span><strong>{person.name}</strong><small>{count(person)} 个视频</small></span>
              <b>{panel.view === "picker" && currentVideo && assignments[videoId(currentVideo)] === person.id ? "已添加" : "›"}</b>
            </button>
          )) : <p className="people-empty">还没有人物。点击“新建人物”开始整理。</p>}
          {panel.view === "picker" && currentVideo && assignments[videoId(currentVideo)] && (
            <button type="button" className="people-remove" disabled={busy} onClick={() => onAssign(null)}>从人物中移除这个视频</button>
          )}
        </div>
      )}
      {pendingTransfer && (
        <div className="people-form-backdrop">
          <div className="people-form" role="dialog" aria-modal="true" aria-label="转移视频到其他人物">
            <h2>转移视频</h2>
            <p>当前人物：{pendingTransfer.fromName}</p>
            <label>转移到
              <select value={transferTarget} disabled={busy} onChange={(event) => setTransferTarget(event.target.value)} aria-label="选择目标人物">
                <option value="">请选择人物</option>
                {people.filter((person) => person.id !== pendingTransfer.fromId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            {people.length < 2 ? <p>请先新建另一个人物，再转移视频。</p> : <p className="people-transfer-tip">确认后，这条视频会从原人物移到所选人物。NAS 原文件和收藏保留。</p>}
            {error && <p role="alert">{error}</p>}
            <div className="people-form-actions">
              <button type="button" disabled={busy} onClick={() => setPendingTransfer(null)}>取消</button>
              <button type="button" className="people-confirm-transfer" disabled={busy || !transferTarget} onClick={transferVideo}>{busy ? "转移中…" : "确认转移"}</button>
            </div>
          </div>
        </div>
      )}
      {pendingRemoval && (
        <div className="people-form-backdrop">
          <div className="people-form" role="alertdialog" aria-modal="true" aria-label="移出人物确认">
            <h2>移出这个视频？</h2>
            <p>只取消与“{profile?.name}”的归类，原视频仍保留在 NAS 中。</p>
            <div className="people-form-actions">
              <button type="button" disabled={busy} onClick={() => setPendingRemoval(null)}>取消</button>
              <button type="button" className="people-confirm-remove" disabled={busy} onClick={removeVideo}>{busy ? "处理中…" : "确认移出"}</button>
            </div>
          </div>
        </div>
      )}
      {form && (
        <div className="people-form-backdrop">
          <form className="people-form" onSubmit={saveForm}>
            <h2>{form === "create" ? "新建人物" : "编辑人物"}</h2>
            <label>名称<input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="输入名称" /></label>
            <label className="people-avatar-picker">头像（可选）<PersonAvatar person={{ name, avatar }} size="normal" /><input type="file" accept="image/*" onChange={chooseAvatar} /></label>
            {avatar && <button type="button" className="people-text-button" onClick={() => setAvatar("")}>使用默认头像</button>}
            {formError && <p role="alert">{formError}</p>}
            <div className="people-form-actions"><button type="button" onClick={() => setForm(null)}>取消</button><button type="submit" disabled={busy}>保存</button></div>
          </form>
        </div>
      )}
    </div>
  );
};

export default PeopleManager;
