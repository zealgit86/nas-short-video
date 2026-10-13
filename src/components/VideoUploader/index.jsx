import { useEffect, useRef, useState } from "react";
import "./index.css";

const ROOTS = [{ key: "mobile", label: "上传目录" }, { key: "library", label: "视频库" }];
const supported = /\.(mp4|mov|webm|ogg)$/i;
const VideoUploader = ({ people, initialPersonId, hash, onClose, onUploaded }) => {
  const [personId, setPersonId] = useState(initialPersonId || "");
  const [directory, setDirectory] = useState(() => {
    try { return localStorage.getItem("erin_upload_directory_v1") || ROOTS[0].key; } catch { return ROOTS[0].key; }
  });
  const [listing, setListing] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const fileInputRef = useRef(null);
  const endpoint = (path, params = {}) => `${window.PUBLIC_URL}/api/${path}?${new URLSearchParams({ hash, ...params })}`;
  useEffect(() => {
    const controller = new AbortController();
    setListing(null);
    setError("");
    fetch(`${window.PUBLIC_URL}/api/upload/folders?${new URLSearchParams({ hash, directory })}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(setListing).catch((e) => { if (e.name !== "AbortError") setError(e.message || "无法读取目录"); });
    return () => controller.abort();
  }, [directory, hash]);
  const createFolder = async () => {
    if (!folderName.trim() || folderBusy) return;
    setFolderBusy(true); setError("");
    try {
      const response = await fetch(endpoint("upload/folders"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directory, name: folderName.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFolderName(""); setDirectory(data.directory);
    } catch (e) { setError(e.message || "新建文件夹失败"); }
    finally { setFolderBusy(false); }
  };
  const chooseFiles = (event) => {
    const selected = Array.from(event.target.files || []);
    if (selected.some((file) => !supported.test(file.name) || !file.size || file.size > 8 * 1024 ** 3)) {
      setError("请选择 MP4、MOV、WEBM 或 OGG 视频，单个不超过 8 GB"); return;
    }
    setFiles(selected); setResults([]); setError("");
  };
  const sendFile = (file) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint("upload", { directory, person: personId, name: file.name }));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded * 100 / event.total)); };
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { return reject(new Error("无法读取上传结果，请刷新人物主页核对后再重试")); }
      if (xhr.status !== 201) return reject(new Error(data.error || "上传失败"));
      resolve(data);
    };
    xhr.onerror = () => reject(new Error("网络中断，请刷新人物主页核对后再重试"));
    xhr.send(file);
  });
  const upload = async () => {
    if (busyRef.current || !personId || !listing || !files.length) return;
    busyRef.current = true; setBusy(true); setError(""); setResults([]);
    let lastSuccess = null;
    try {
      try { localStorage.setItem("erin_upload_directory_v1", directory); } catch {}
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setCurrent(`${index + 1} / ${files.length}：${file.name}`); setProgress(0);
        try {
          const result = await sendFile(file);
          lastSuccess = result;
          setResults((rows) => [...rows, { name: result.name, success: true }]);
        } catch (e) { setResults((rows) => [...rows, { name: file.name, success: false, error: e.message }]); }
      }
      if (lastSuccess) await onUploaded(lastSuccess);
      setFiles([]); setCurrent("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) { setError(e.message || "文件已上传，请刷新人物主页查看"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <div className="video-upload-overlay" role="dialog" aria-modal="true" aria-label="上传视频到人物">
    <div className="video-upload-panel">
      <header><h2>上传视频</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭上传">×</button></header>
      <label>添加到人物<select value={personId} disabled={busy} onChange={(e) => setPersonId(e.target.value)}><option value="">请选择人物</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>保存位置<select aria-label="选择视频根目录" disabled={busy || folderBusy} value={ROOTS.find((r) => directory === r.key || directory.startsWith(r.key + "/"))?.key || ""} onChange={(e) => setDirectory(e.target.value)}>{ROOTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <p className="upload-path">{listing?.displayPath || "正在读取目录…"}</p>
      <div className="upload-folder-list">
        {listing?.parent && <button type="button" disabled={busy || folderBusy} onClick={() => setDirectory(listing.parent)}>‹ 返回上级目录</button>}
        {listing?.folders.map((name) => <button type="button" key={name} disabled={busy || folderBusy} onClick={() => setDirectory(directory + "/" + name)}>📁 {name} ›</button>)}
        {listing && !listing.folders.length && <p>没有子文件夹，将保存到当前目录</p>}
      </div>
      <div className="upload-new-folder"><input aria-label="新文件夹名称" placeholder="新文件夹名称" maxLength={120} value={folderName} disabled={busy || folderBusy} onChange={(e) => setFolderName(e.target.value)} /><button type="button" disabled={busy || folderBusy || !listing || !folderName.trim()} onClick={createFolder}>新建文件夹</button></div>
      <label className="upload-file-picker">从相册或文件选择视频<input ref={fileInputRef} aria-label="选择上传的视频" type="file" accept="video/*,.mp4,.mov,.webm,.ogg" multiple disabled={busy} onChange={chooseFiles} /></label>
      {files.length > 0 && <p>已选择 {files.length} 个视频</p>}
      <p className="upload-tip">上传后自动加入索引和所选人物。同名视频自动改名，上传时请保持页面打开。</p>
      {error && <p className="upload-error" role="alert">{error}</p>}
      {busy && <div role="status"><p>{current}</p><progress value={progress} max="100" /><p>{progress === 100 ? "正在保存并添加到人物…" : `上传中 ${progress}%`}</p></div>}
      {!!results.length && <div className="upload-results" role="status">{results.map((row, i) => <p key={i}>{row.success ? "✓ 已上传" : "✕ 未上传"}：{row.name}{row.error && `（${row.error}）`}</p>)}</div>}
      <button type="button" className="upload-start" disabled={busy || folderBusy || !personId || !listing || !files.length} onClick={upload}>{busy ? "正在上传…" : "开始上传"}</button>
    </div>
  </div>;
};
export default VideoUploader;
