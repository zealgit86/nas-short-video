// Dependencies
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Components
import VideoFeed from "./components/VideoFeed";

// Assets
import { faCompactDisc, faFolderOpen, faPause, faPlay } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { usePrevious } from "@uidotdev/usehooks";
import BlacklistManager from "./components/BlacklistManager";
import BottomMetadata from "./components/BottomMetadata";
import PlaylistsViewer from "./components/PlaylistsViewer";
import PlaylistGallery from "./components/PlaylistGallery";
import "./App.css";
import "./tiktok.css";
import SideControls from "./components/SideControls";
import FavoritesGallery from "./components/FavoritesGallery";
import PeopleManager from "./components/PeopleManager";
import VideoUploader from "./components/VideoUploader";
import { createPersonId, peopleEndpoint, videoId } from "./peopleStore";
import { withVideoAvatars } from "./personAvatars";
import { legacyIphoneUrl, migrateBrowserMediaState, movedIphonePath } from "./mediaMigration";

const PLAYBACK_SPEEDS = [1, 1.5, 2];

const App = () => {
  // Misc - General niceties
  const _reloadPage = (evt) => {
    evt.preventDefault();
    window.location.reload();
  };
  const _makeHTTPHeaders = () => {
    const headers = { Accept: "application/json" };
    if (window.USE_SECRET && !secureHash)
      headers["Authorization"] = `Basic ${btoa(`Erin:${formSecret}`)}`;
    return headers;
  };
  const _clearStoredSecret = () => {
    localStorage.removeItem("erin_secret");
  };
  const _storeSecret = (s) => {
    localStorage.setItem("erin_secret", s);
  };
  const _getBlacklist = () => {
    const l = localStorage.getItem("erin_blacklist");
    if (!l) return [];
    return JSON.parse(l);
  };
  const _addToBlackList = (v) => {
    let l = _getBlacklist();
    l = [...l, v];
    localStorage.setItem("erin_blacklist", JSON.stringify(l));
  };
  const _removeFromBlacklist = (v) => {
    let l = _getBlacklist();
    l = l.filter((_v) => v.url !== _v.url);
    localStorage.setItem("erin_blacklist", JSON.stringify(l));
  };
  const _isVideo = (file) =>
    ["mp4", "mov", "ogg", "webm"].includes(file.name.toLowerCase().split(".").at(-1));
  const _isImage = (file) =>
    ["jpg", "jpeg", "png", "webp"].includes(
      file.name.toLowerCase().split(".").at(-1),
    );
  const _getShareFragment = (v) =>
    window._btoaSafe(
      v.url
        .replace(window.PUBLIC_URL, "")
        .split("?")[0]
    );
  const _copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (!document.execCommand("copy"))
        throw new Error("Unable to copy share URL");
    } finally {
      document.body.removeChild(textarea);
    }
  };
  const _isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const _toAuthenticatedUrl = (url) => `${url}?hash=${secureHash}`;
  const _veryFirsPageTitle = useMemo(() => document.title, []);
  const _updatePageTitle = (media = null) => {
    if (media) {
      if (!_veryFirsPageTitle.includes("[VIDEO_TITLE]"))
        document.title = _veryFirsPageTitle;
      else
        document.title = _veryFirsPageTitle.replace(
          "[VIDEO_TITLE]",
          media.title,
        );
    } else if (window.USE_SECRET) document.title = "Erin - Authentication";
  };
  const _injectCustomStylesheet = () => {
    const node = document.createElement("link");

    node.type = "text/css";
    node.rel = "stylesheet";
    node.href = "/custom.css";

    document.head.appendChild(node);
  };
  const _shuffleArray = (arr) => {
    const copy = [...arr];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  };
  // Source : https://stackoverflow.com/questions/7449588/why-does-decodeuricomponent-lock-up-my-browser
  window._decodeURIComponentSafe = (s) => {
    if (!s) return s;
    return decodeURIComponent(s.replace(/%(?![0-9a-fA-F]+)/g, "%25"));
  };
  window._btoaSafe = (s) => btoa(unescape(encodeURIComponent(s)));

  const _scrollDirection = document
    .querySelector("html")
    .getAttribute("data-scroll-direction");

  // Members - Form & Auth management
  const [autoconnect, setAutoconnect] = useState(false);
  const [hasEverSubmitted, setHasEverSubmitted] = useState(false);
  const [formSecret, setFormSecret] = useState("");
  const [secureHash, setSecureHash] = useState("");
  const handleInputSecret = (e) => setFormSecret(e.target.value);

  // Member - Determines whether we are able to communicate with the remote server
  const [loading, setLoading] = useState(false);
  const [hasReachedRemoteServer, setHasReachedRemoteServer] = useState(false);

  // Member - Determines whether the audio is currently muted
  const [muted, setMuted] = useState(window.START_MUTED ?? true);
  const toggleMute = () => {
    setMuted(!muted);
  };
  const [playbackSpeed, setPlaybackSpeed] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("erin_playback_speed_v1"));
      return PLAYBACK_SPEEDS.includes(saved) ? saved : 1;
    } catch {
      return 1;
    }
  });
  const cyclePlaybackSpeed = () => {
    setPlaybackSpeed((speed) =>
      PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(speed) + 1) % PLAYBACK_SPEEDS.length],
    );
  };
  useEffect(() => {
    try {
      localStorage.setItem("erin_playback_speed_v1", String(playbackSpeed));
    } catch {}
  }, [playbackSpeed]);

  const feedRef = useRef(null);

  // Member - Saves a { url , title , extension , filename , playlist , metadataURL  } dictionary for every video discovered
  // "allVideos" and "videos" differ in that "allVideos" hold all the files regardless of current playlist
  // while "videos" holds only the current playlist's videos ( = all videos if no playlist, or a segment of it if any )
  const [allVideos, setAllVideos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [feedMode, setFeedMode] = useState("recommended");
  const [favoritesPlaying, setFavoritesPlaying] = useState(false);
  const [favoriteQueue, setFavoriteQueue] = useState([]);
  const [favoriteStartIndex, setFavoriteStartIndex] = useState(0);
  const [directoryStartIndex, setDirectoryStartIndex] = useState(null);
  const [indexRefreshing, setIndexRefreshing] = useState(false);
  const [indexMessage, setIndexMessage] = useState("");
  const indexRefreshBusy = useRef(false);
  const favoriteReturnPosition = useRef({ scrollTop: 0, videoId: null });
  const [feedRevision, setFeedRevision] = useState(0);
  const [favorites, setFavorites] = useState(() => {
    try {
      migrateBrowserMediaState();
      return new Set(JSON.parse(localStorage.getItem("erin_favorites_v1") || "[]"));
    } catch {
      return new Set();
    }
  });
  const favoriteId = videoId;
  const updateFavorites = (video, action = "toggle") => {
    if (!video) return;
    const id = favoriteId(video);
    const removingCurrentFavorite =
      action !== "add" && feedMode === "favorites" && favorites.has(id);
    setFavorites((previous) => {
      const alreadyFavorite = previous.has(id);
      if (action === "add" && alreadyFavorite) return previous;
      const next = new Set(previous);
      if (action === "add" || !alreadyFavorite) next.add(id);
      else next.delete(id);
      return next;
    });
    if (removingCurrentFavorite) {
      const remaining = visibleVideos.filter((item) => videoId(item) !== id);
      const index = mainVideo && videoId(mainVideo) !== id
        ? Math.max(0, remaining.findIndex((item) => videoId(item) === videoId(mainVideo)))
        : Math.max(0, Math.min(currentVideoIndex, remaining.length - 1));
      setFavoriteQueue(remaining);
      setFavoriteStartIndex(index);
      setCurrentVideoIndex(index);
      setFeedRevision((revision) => revision + 1);
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem("erin_favorites_v1", JSON.stringify([...favorites]));
    } catch {}
  }, [favorites]);
  const switchFeedMode = (mode) => {
    if (feedMode === mode) return;
    setFavoritesPlaying(false);
    setFavoriteQueue([]);
    setCurrentVideoIndex(0);
    setFeedRevision((revision) => revision + 1);
    setFeedMode(mode);
  };
  const [peopleData, setPeopleData] = useState(null);
  const peopleDataRef = useRef(null);
  const peopleSavingRef = useRef(false);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peoplePanel, setPeoplePanel] = useState(null);
  const [uploadPersonId, setUploadPersonId] = useState(null);
  const [personPlayback, setPersonPlayback] = useState(null);
  const [personPlaybackIndex, setPersonPlaybackIndex] = useState(0);
  const [personReturnPosition, setPersonReturnPosition] = useState(null);
  const personFeedRef = useRef(null);
  const people = useMemo(() => withVideoAvatars(peopleData?.people || [],
    peopleData?.assignments || {}, allVideos, window.PUBLIC_URL), [peopleData, allVideos]);
  const assignments = peopleData?.assignments || {};

  useEffect(() => {
    if (!hasReachedRemoteServer || !secureHash) return;
    let cancelled = false;
    fetch(peopleEndpoint(secureHash), { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("无法读取人物资料"); return response.json(); })
      .then((data) => { if (!cancelled) { peopleDataRef.current = data; setPeopleData(data); setPeopleError(""); } })
      .catch((error) => { if (!cancelled) setPeopleError(error.message); });
    return () => { cancelled = true; };
  }, [hasReachedRemoteServer, secureHash]);

  const savePeople = async (change) => {
    if (peopleSavingRef.current || !peopleDataRef.current) return false;
    peopleSavingRef.current = true;
    setPeopleBusy(true);
    setPeopleError("");
    const updated = change(peopleDataRef.current);
    try {
      const response = await fetch(peopleEndpoint(secureHash), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      const result = await response.json();
      if (response.status === 409) {
        peopleDataRef.current = result;
        setPeopleData(result);
        throw new Error("其他设备更新了人物资料，请重试本次操作");
      }
      if (!response.ok) throw new Error("保存失败，请稍后重试");
      peopleDataRef.current = result;
      setPeopleData(result);
      return true;
    } catch (error) {
      setPeopleError(error.message);
      return false;
    } finally {
      peopleSavingRef.current = false;
      setPeopleBusy(false);
    }
  };

  const openPeoplePanel = (view, personId = null) => {
    if (!peopleDataRef.current) setPeopleError("人物资料尚未加载，请稍后重试");
    feedRef.current?.pausePlayback();
    setPeoplePanel({ view, personId });
  };
  const closePeoplePanel = () => {
    setPeoplePanel(null);
    if (!personPlayback) feedRef.current?.playPlayback();
  };
  const assignPerson = async (personId) => {
    const video = mainVideo;
    if (!video) return false;
    const id = videoId(video);
    const ok = await savePeople((current) => {
      const next = { ...current.assignments };
      if (personId) next[id] = personId;
      else delete next[id];
      return { ...current, assignments: next };
    });
    if (ok) closePeoplePanel();
    return ok;
  };
  const removePersonVideo = (video, personId) => savePeople((current) => {
    const next = { ...current.assignments };
    if (next[videoId(video)] === personId) delete next[videoId(video)];
    return { ...current, assignments: next };
  });
  const transferPersonVideo = (video, fromPersonId, toPersonId) => {
    const current = peopleDataRef.current;
    if (!current || current.assignments[videoId(video)] !== fromPersonId) {
      setPeopleError("这条视频的归类已改变，请刷新后重试");
      return Promise.resolve(false);
    }
    if (toPersonId === fromPersonId || !current.people.some((person) => person.id === toPersonId)) {
      setPeopleError("请选择另一个人物");
      return Promise.resolve(false);
    }
    return savePeople((data) => ({
      ...data,
      assignments: { ...data.assignments, [videoId(video)]: toPersonId },
    }));
  };
  const createPerson = async (name, avatar, assignCurrent) => {
    const id = createPersonId();
    const currentVideo = mainVideo;
    const ok = await savePeople((current) => ({
      ...current,
      people: [...current.people, { id, name, avatar }],
      assignments: assignCurrent && currentVideo
        ? { ...current.assignments, [videoId(currentVideo)]: id }
        : current.assignments,
    }));
    if (ok) setPeoplePanel({ view: "profile", personId: id });
    return ok;
  };
  const updatePerson = (id, name, avatar) => savePeople((current) => ({
    ...current,
    people: current.people.map((person) => person.id === id ? { ...person, name, avatar } : person),
  }));
  const openPersonPlayback = (person, selected, list) => {
    const index = list.findIndex((video) => videoId(video) === videoId(selected));
    if (index < 0) return;
    setPersonPlayback({ person, videos: [...list], initialIndex: index });
    setPersonPlaybackIndex(index);
  };
  const closePersonPlayback = () => {
    const video = personPlayback?.videos[personPlaybackIndex];
    personFeedRef.current?.pausePlayback();
    setPersonReturnPosition({ personId: personPlayback?.person.id, videoId: video ? videoId(video) : null });
    setPersonPlayback(null);
  };
  const [currentVideoMetadata, setCurrentVideoMetadata] = useState(false);
  const focusRequestRef = useRef(0);
  const previousVideoIndex = usePrevious(currentVideoIndex);
  const handleVideoFocus = useCallback((v, i) => {
    const focusRequest = ++focusRequestRef.current;

    // Update the browser tab's title
    _updatePageTitle(v);

    // Refresh internal state
    setCurrentVideoIndex(i);

    // Fetch metadata if any
    if (v && v.metadataURL) {
      return fetch(v.metadataURL, {
        method: "GET",
        headers: _makeHTTPHeaders(),
      })
        .then((r) => r.json())
        .then((r) => {
          if (focusRequest !== focusRequestRef.current) return;

          const playlistMetadata =
            _freshPlaylists.current.find((p) => p.name === v.playlist)
              ?.metadata || {};
          setCurrentVideoMetadata({
            channel_image: playlistMetadata.channel_image,
            channel_name: playlistMetadata.channel_name,
            ...r,
          });

          const titleField =
            v.type === "image" ? "image_title" : "video_title";
          if (r[titleField]) _updatePageTitle({ title: r[titleField] });
        });
    }
    // Retrieve metadata from the parent playlist if any
    else if (
      v &&
      _freshPlaylists.current.some(
        (p) => p.name === v.playlist && p.metadataURL,
      )
    ) {
      const _playlist = _freshPlaylists.current.find(
        (p) => p.name === v.playlist,
      );
      setCurrentVideoMetadata(_playlist.metadata);

      if (_playlist.metadata && _playlist.metadata.channel_title)
        _updatePageTitle({ title: _playlist.metadata.channel_title });
    } else {
      setCurrentVideoMetadata(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const handleVideoFinish = () => {
    if (!window.AUTOPLAY_ENABLED) return;
    document
      .querySelector(".feed")
      .scrollBy(
        _scrollDirection === "vertical"
          ? { top: 1, left: 0, behavior: "smooth" }
          : { top: 0, left: 1, behavior: "smooth" },
      );
  };

  // Member - Save playlists
  const [playlists, setPlaylists] = useState([]);
  const _playlistsMetadataLoaded = useRef(false);

  // An internal member used as a trick to get the latest playlists information
  // within the setCurrentVideoMetadata() callback
  const _freshPlaylists = useRef(playlists);
  useEffect(() => {
    _freshPlaylists.current = playlists;
  }, [playlists]);

  // Member - Trick to trigger state updates on localStorage updates
  const [blackListUpdater, setBlacklistUpdater] = useState(0);

  const favoriteVideos = useMemo(() => {
    const masked = new Set(_getBlacklist().map((video) => video.url));
    const byId = new Map(allVideos.filter((video) => !masked.has(video.url)).map((video) => [videoId(video), video]));
    return [...favorites].reverse().map((id) => byId.get(id)).filter(Boolean);
  }, [allVideos, favorites, blackListUpdater]); // eslint-disable-line react-hooks/exhaustive-deps
  const openFavoriteVideo = (video, scrollTop) => {
    const index = favoriteVideos.findIndex((item) => videoId(item) === videoId(video));
    if (index < 0) return;
    favoriteReturnPosition.current = { scrollTop, videoId: videoId(video) };
    setFavoriteQueue([...favoriteVideos]);
    setFavoriteStartIndex(index);
    setCurrentVideoIndex(index);
    setFeedRevision((value) => value + 1);
    setFavoritesPlaying(true);
  };
  const backToFavorites = () => {
    feedRef.current?.pausePlayback();
    favoriteReturnPosition.current = { ...favoriteReturnPosition.current, videoId: mainVideo ? videoId(mainVideo) : null };
    setFavoritesPlaying(false);
  };
  // Keep the recommendation order stable when favorites change.
  const recommendedVideos = useMemo(() => {
    const masked = new Set(_getBlacklist().map((video) => video.url));
    return videos.filter((video) => !masked.has(video.url));
  }, [videos, blackListUpdater]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleVideos = useMemo(() => {
    if (feedMode !== "favorites") return recommendedVideos;
    if (!favoritesPlaying) return favoriteVideos;
    const available = new Set(favoriteVideos.map(videoId));
    return favoriteQueue.filter((video) => available.has(videoId(video)));
  }, [recommendedVideos, feedMode, favoritesPlaying, favoriteQueue, favoriteVideos]);
  const mainVideo = visibleVideos[currentVideoIndex];
  const currentPerson = people.find((person) => person.id === assignments[mainVideo ? videoId(mainVideo) : ""]);

  // Video control - Download the current video
  const downloadVideo = (video) => {
    if (!video) return;
    const url = video.url;

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = url.split("?")[0].split("/").pop();
    anchor.target = "_blank";

    document.body.appendChild(anchor);

    anchor.click();

    document.body.removeChild(anchor);
  };
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteBusyRef = useRef(false);
  const requestDelete = (video) => {
    if (!video) return;
    feedRef.current?.pausePlayback();
    personFeedRef.current?.pausePlayback();
    setDeleteError("");
    setDeleteTarget(video);
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deleteBusyRef.current || peopleSavingRef.current) return;
    deleteBusyRef.current = true;
    setDeleteBusy(true);
    setDeleteError("");
    const id = videoId(deleteTarget);
    try {
      const response = await fetch(_toAuthenticatedUrl(`${window.PUBLIC_URL}/api/video`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video: id, confirmPermanentDelete: true }),
      });
      if (!response.ok) throw new Error("删除失败，请刷新页面确认视频状态后重试");
      const result = await response.json();
      peopleDataRef.current = result.people;
      setPeopleData(result.people);
      setAllVideos((list) => list.filter((video) => videoId(video) !== id));
      const following = visibleVideos[(currentVideoIndex + (mainVideo && videoId(mainVideo) === id ? 1 : 0)) % visibleVideos.length];
      setVideos((list) => {
        const remaining = list.filter((video) => videoId(video) !== id);
        const start = following ? remaining.findIndex((video) => videoId(video) === videoId(following)) : 0;
        return start > 0 ? [...remaining.slice(start), ...remaining.slice(0, start)] : remaining;
      });
      const remainingFavorites = favoriteQueue.filter((video) => videoId(video) !== id);
      const favoriteIndex = following ? remainingFavorites.findIndex((video) => videoId(video) === videoId(following)) : 0;
      setFavoriteQueue(remainingFavorites);
      setFavoriteStartIndex(Math.max(0, favoriteIndex));
      setFavorites((previous) => { const next = new Set(previous); next.delete(id); return next; });
      _removeFromBlacklist(deleteTarget);
      setBlacklistUpdater((value) => value + 1);
      setPersonPlayback(null);
      setCurrentVideoIndex(feedMode === "favorites" ? Math.max(0, visibleVideos.filter((video) => videoId(video) !== id).findIndex((video) => following && videoId(video) === videoId(following))) : 0);
      setFeedRevision((value) => value + 1);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      deleteBusyRef.current = false;
      setDeleteBusy(false);
    }
  };
  const download = () => downloadVideo(mainVideo);

  // Video side control - Share a link to the video
  const shareVideo = async (videoMetadata) => {
    if (!videoMetadata) return { status: "failed" };
    const shareURL = new URL("/", window.location.origin);
    shareURL.searchParams.set("play", _getShareFragment(videoMetadata));

    const shareData = {
      title: videoMetadata.title,
      url: shareURL.toString(),
    };

    let canUseNativeShare = typeof navigator.share === "function";
    if (canUseNativeShare && typeof navigator.canShare === "function") {
      try {
        canUseNativeShare = navigator.canShare(shareData);
      } catch {
        canUseNativeShare = false;
      }
    }

    if (canUseNativeShare) {
      try {
        await navigator.share(shareData);
        return { status: "shared" };
      } catch (error) {
        if (error.name === "AbortError") return { status: "cancelled" };
      }
    }

    try {
      await _copyText(shareData.url);
      return { status: "copied" };
    } catch {
      return { status: "manual-copy", url: shareData.url };
    }
  };
  const share = () => shareVideo(mainVideo);

  // Video control - Blacklist
  const blacklist = () => {
    const video = visibleVideos[currentVideoIndex];
    _addToBlackList(video);

    if (
      currentVideoIndex === visibleVideos.length - 1 &&
      visibleVideos.length > 1
    ) {
      document
        .querySelector(".feed")
        .scrollBy(
          _scrollDirection === "vertical"
            ? { top: -1, left: 0, behavior: "smooth" }
            : { top: 0, left: -1, behavior: "smooth" },
        );
    } else {
      document
        .querySelector(".feed")
        .scrollBy(
          _scrollDirection === "vertical"
            ? { top: 1, left: 0, behavior: "smooth" }
            : { top: 0, left: 1, behavior: "smooth" },
        );
    }

    setTimeout(
      () => {
        setBlacklistUpdater(blackListUpdater + 1);

        // The last video is about to be removed - An array of 2 will become an array of 1
        if (visibleVideos.length === 2) setCurrentVideoIndex(0);
        // There are more than 2 videos, and we have removed one in the middle -> We adjust the current index
        else if (
          visibleVideos.length > 2 &&
          previousVideoIndex <= visibleVideos.length - 1 &&
          currentVideoIndex > 0 &&
          currentVideoIndex === visibleVideos.length - 2 &&
          previousVideoIndex > 0
        ) {
          setCurrentVideoIndex(currentVideoIndex - 1);
        }
      },

      // Show no delay when the last video is removed
      visibleVideos.length > 1 ? 800 : 0,
    );
  };

  // Video control - Toggle Play / Pause
  const [isPlaying, setIsPlaying] = useState(true);
  const togglePlayPause = () => {
    feedRef.current?.togglePlayback();
  };

  // Member - Manage blacklist UI
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const openBlacklist = () => {
    setBlacklistOpen(true);
  };
  const hideBlacklist = () => {
    setBlacklistOpen(false);
  };
  const removeFromBlacklist = (v) => {
    _removeFromBlacklist(v);
    setBlacklistUpdater(blackListUpdater + 1);
  };

  // Member - Manage playlist viewer UI
  const [playlistsViewerOpen, setPlaylistsViewerOpen] = useState(false);
  const openPlaylistsViewer = () => {
    setPlaylistsViewerOpen(true);
  };
  const hidePlaylistsViewer = () => {
    setPlaylistsViewerOpen(false);
  };

  // Member - Manage playlist gallery UI
  const [activePlaylistForGallery, setActivePlaylistForGallery] = useState({});
  const [playlistGalleryOpen, setPlaylistGalleryOpen] = useState(false);
  const openPlaylistGallery = (playlist) => {
    setActivePlaylistForGallery({
      name: playlist.name,
      videos: allVideos.filter(
        (_v) =>
          _v.playlist === playlist.name &&
          !_getBlacklist()
            .map((v) => v.url)
            .includes(_v.url),
      ),
      metadata: playlist.metadata,
    });
    setPlaylistGalleryOpen(true);
  };
  const hidePlaylistGallery = () => {
    setPlaylistGalleryOpen(false);
  };

  // Method - Test connectivity with the remote server
  const attemptToReachRemoteServer = (evt) => {
    if (evt) evt.preventDefault();

    setLoading(true);

    if (evt) setHasEverSubmitted(true);

    fetch(`${window.PUBLIC_URL}/media/`, {
      method: "HEAD",
      cache: "no-cache",
      headers: _makeHTTPHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r;
      })
      .then((r) => {
        if (window.USE_SECRET) {
          _storeSecret(formSecret);
          setSecureHash(r.headers.get("x-erin-hash"));
        }
        setHasReachedRemoteServer(true);
      })
      .catch((_) => {
        _clearStoredSecret();
        setHasReachedRemoteServer(false);
      })
      .finally((_) => {
        setLoading(false);
      });
  };

  // Method - Recursive video retrieval
  const _retrieveVideosRecursively = (path = "") => {
    return fetch(
      _toAuthenticatedUrl(
        `${window.PUBLIC_URL}/media/${encodeURIComponent(path)}`,
      ),
      {
        method: "GET",
        cache: "no-cache",
        headers: _makeHTTPHeaders(),
      },
    )
      .then((r) => r.json())
      .then(
        (files) =>
          new Promise((res, rej) => {
            if (!files) return res([]);

            let _folders = files.filter((f) => f.is_dir);
            let _files = files
              .filter((f) => !f.is_dir)
              .map((f) => ({ ...f, url: `${path}${f.url.slice(2).trim()}` }));

            if (window.IGNORE_HIDDEN_PATHS) {
              _folders = _folders.filter((f) => !f.name.startsWith("."));
              _files = _files.filter((f) => !f.name.startsWith("."));
            }

            const promises = _folders.map((f) =>
              _retrieveVideosRecursively(`${path}${f.name}`),
            );
            Promise.all(promises).then((results) => {
              res([...results.flat(), ..._files]);
            });
          }),
      )
      .catch((_) => new Promise((res, rej) => res([])));
  };

  // Method - Retrieve all the video links (and generate the associated playlists based on folder structure)
  const retrieveVideos = (showLoader = true) => {
    if (showLoader) setLoading(true);

    return fetch(_toAuthenticatedUrl(`${window.PUBLIC_URL}/api/catalog`), {
      method: "GET",
      cache: "no-cache",
      headers: _makeHTTPHeaders(),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Media catalog unavailable");
        return response.json();
      })
      .catch(() => _retrieveVideosRecursively())
      .then((files) => {
      if (!files) setLoading(false);

      // Put metadata files at the end to prevent misses while matching media.
      files.sort(
        (a, b) =>
          Number(a.name.toLowerCase().endsWith(".json")) -
          Number(b.name.toLowerCase().endsWith(".json")),
      );

      let _playlistsMetadataTracker = {};
      let _videoFiles = {};
      for (let i = 0; i < files.length; i++) {
        const current = files[i];
        const _filenameStem = current.name
          .split(".")
          .slice(0, -1)
          .join(".");
        const _id = current.url.split(".").slice(0, -1).join(".");

        if (!_filenameStem || current.is_dir) continue;

        // Case : Supported media file
        if (_isVideo(current) || _isImage(current)) {
          const type = _isImage(current) ? "image" : "video";
          const extension = current.name.toLowerCase().split(".").at(-1);
          if (type === "image" || !_isSafari || extension !== "ogg")
            _videoFiles[_id] = {
              type,
              url: _toAuthenticatedUrl(
                `${window.PUBLIC_URL}/media/${current.url
                  .split("/")
                  .map(encodeURIComponent)
                  .join("/")}`,
              ),
              filename: current.name,
              title: current.name
                .replaceAll("-", " ")
                .replaceAll("__", " - ")
                .split(".")
                .slice(0, -1)
                .join(""),
              extension,
              // playlist: current.url.replace(current.name, ""),
              playlist: current.url.substr(0, current.url.lastIndexOf("/")),
              metadataURL: false,
            };

          continue;
        }

        // Case : Metadata file for a media item
        if (_id in _videoFiles) {
          _videoFiles[_id].metadataURL = _toAuthenticatedUrl(
            `${window.PUBLIC_URL}/media/${current.url}`,
          );
          continue;
        }

        // Case : Metadata file for a playlist
        if (_filenameStem === "metadata") {
          const _name = current.url.substr(0, current.url.lastIndexOf("/"));
          _playlistsMetadataTracker[_name] = _toAuthenticatedUrl(
            `${window.PUBLIC_URL}/media/${current.url}`,
          );
        }
      }

      _videoFiles = Object.values(_videoFiles);
      // try {
      //   _storeVideos(_videoFiles);
      // } catch (_) {}

      // Record all videos for later use
      setAllVideos(_videoFiles);

      // Playlist extraction
      const _allPlaylists = [
        ...new Set(_videoFiles.map((v) => v.playlist).filter((p) => p)),
      ].sort();
      setPlaylists(
        _allPlaylists.map((_p) => ({
          name: _p,
          metadataURL: _playlistsMetadataTracker[_p] || false,
        })),
      );

      // Filter video files retrieved according to the current url-defined playlist
      let currentPlaylist = window._decodeURIComponentSafe(
        window.location.pathname.substring(1),
      );
      if (currentPlaylist && currentPlaylist.substr(-1) === "/")
        currentPlaylist = currentPlaylist.substring(
          0,
          currentPlaylist.length - 1,
        );
      currentPlaylist = movedIphonePath(currentPlaylist);

      if (currentPlaylist) {
        _videoFiles = _videoFiles.filter((v) => v.playlist === currentPlaylist);
        setActivePlaylistForGallery({
          name: currentPlaylist,
          videos: _videoFiles,
        });
      }

      // If any video is provided in the URL, make sure that it appears first ( = "share" feature )
      const query = new URLSearchParams(window.location.search);
      let currentVideoFromURL = null;
      if (query.has("play")) {
        const suppliedFragment = query.get("play");

        if (!currentPlaylist)
          currentVideoFromURL = _videoFiles.find(
            (v) => _getShareFragment(v) === suppliedFragment ||
              (legacyIphoneUrl(v.url) &&
                _getShareFragment({ ...v, url: legacyIphoneUrl(v.url) }) === suppliedFragment),
          );
        else
          currentVideoFromURL = _videoFiles.find(
            (v) => window._btoaSafe(v.filename) === suppliedFragment,
          );

        if (currentVideoFromURL && query.get("gallery") !== "1")
          _videoFiles = _videoFiles.filter(
            (v) => v.url !== currentVideoFromURL.url,
          );
      }

      if (currentVideoFromURL && query.get("gallery") === "1") {
        const selectedIndex = _videoFiles.findIndex((video) => videoId(video) === videoId(currentVideoFromURL));
        setDirectoryStartIndex(selectedIndex);
        setCurrentVideoIndex(selectedIndex);
        setVideos(_videoFiles);
      } else {
      setDirectoryStartIndex(null);
      setVideos(() => {
        return currentVideoFromURL
          ? [currentVideoFromURL, ..._shuffleArray(_videoFiles)]
          : _shuffleArray(_videoFiles);
      });
      }

      setLoading(false);
    });
  };

  const refreshIndex = async () => {
    if (indexRefreshBusy.current) return;
    indexRefreshBusy.current = true;
    setIndexRefreshing(true);
    setIndexMessage("正在扫描两个视频目录，请稍候…");
    const endpoint = _toAuthenticatedUrl(`${window.PUBLIC_URL}/api/index/refresh`);
    try {
      const start = await fetch(endpoint, { method: "POST", headers: _makeHTTPHeaders() });
      if (!start.ok) throw new Error("无法启动扫描，请重试");
      let result = await start.json();
      const jobId = result.jobId;
      while (result.state === "running") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const response = await fetch(endpoint, { cache: "no-store", headers: _makeHTTPHeaders() });
        if (!response.ok) throw new Error("无法读取扫描结果，请重试");
        result = await response.json();
        if (result.jobId !== jobId) throw new Error("扫描已重新启动，请重试以读取最新结果");
      }
      if (result.state !== "complete") throw new Error(result.error || "扫描失败，原索引保留");
      setCurrentVideoIndex(0);
      setFavoritesPlaying(false);
      setFeedRevision((value) => value + 1);
      await retrieveVideos();
      setIndexMessage(`刷新完成：新增 ${result.added} 个视频，共 ${result.total} 个视频${result.removed ? `；移除 ${result.removed} 条失效索引` : ""}`);
    } catch (error) {
      setIndexMessage(error.message || "刷新失败，请重试");
    } finally {
      indexRefreshBusy.current = false;
      setIndexRefreshing(false);
    }
  };

  // Memoized component - Video Feed
  const Feed = useMemo(
    () => {
      return (
        <VideoFeed
          ref={feedRef}
          key={`${feedMode}:${feedRevision}:${blackListUpdater}`}
          startAtIndex={feedMode === "favorites" ? favoriteStartIndex : directoryStartIndex ?? undefined}
          initialIndex={
            currentVideoIndex > 0
              ? previousVideoIndex <= visibleVideos.length - 1 &&
                previousVideoIndex > 0
                ? currentVideoIndex - 2
                : currentVideoIndex - 1
              : 0
          }
          jumpToEnd={
            previousVideoIndex === visibleVideos.length &&
            visibleVideos.length > 1
              ? true
              : false
          }
          jumpBackForward={
            previousVideoIndex !== visibleVideos.length && currentVideoIndex > 1
          }
          videos={visibleVideos}
          muted={muted}
          playbackSpeed={playbackSpeed}
          onFocusVideo={handleVideoFocus}
          onFinishVideo={handleVideoFinish}
          onPlaybackStateChange={setIsPlaying}
          onDoubleTap={(video) => updateFavorites(video, "add")}
        />
      );
    },
    [visibleVideos, muted, playbackSpeed, feedMode, feedRevision, favoriteStartIndex, directoryStartIndex], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Hook - On mount
  // - Retrieve the locally-stored secret
  // - Attempt to hide the address bar
  // - Retrieve the cache if any
  // - Load the custom stylesheet if configured
  useEffect(() => {
    window.onload = () => {
      setTimeout(() => {
        window.scrollTo(0, 1);
      }, 0);
    };

    if (window.USE_CUSTOM_SKIN) _injectCustomStylesheet();

    _updatePageTitle();

    if (!window.USE_SECRET) {
      setAutoconnect(true);
      return;
    }

    const storedSecret = localStorage.getItem("erin_secret");

    if (!storedSecret || storedSecret.length === 0) return;

    setFormSecret(storedSecret);
    setAutoconnect(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hook - When locally-stored secret was retrieved - Auto-connect to the remote server
  useEffect(() => {
    if (!autoconnect) return;

    attemptToReachRemoteServer();
  }, [autoconnect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hook - When the remote server was reached and the user was authenticated - Retrieve the videos
  useEffect(() => {
    if (!hasReachedRemoteServer) return;

    retrieveVideos();
  }, [secureHash, hasReachedRemoteServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hook - When the playlists are loaded
  // - Load all their metadata via async HTTP calls
  useEffect(() => {
    if (!playlists || playlists.length === 0) return;

    if (_playlistsMetadataLoaded.current) return;

    Promise.all(
      playlists.map((p) =>
        !p.metadataURL
          ? new Promise((res, rej) => res(p))
          : fetch(p.metadataURL, { method: "GET", headers: _makeHTTPHeaders() })
              .then((r) => r.json())
              .then((r) => ({ ...p, metadata: r })),
      ),
    ).then((results) => {
      _playlistsMetadataLoaded.current = true;
      setPlaylists(results);

      // Force-refresh the video metadata after the playlists' metadata were loaded
      setTimeout(() => {
        handleVideoFocus(videos[currentVideoIndex], currentVideoIndex);
      }, 0);
    });
  }, [playlists]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (uploadPersonId !== null || peoplePanel || playlistsViewerOpen) feedRef.current?.pausePlayback();
  }, [uploadPersonId, peoplePanel, playlistsViewerOpen, videos]);

  return (
    <div className="screen">
      <div className="container">
        {/* STATE - Loading */}
        {loading && (
          <div className="loading-state">
            <FontAwesomeIcon icon={faCompactDisc} />
          </div>
        )}

        {!loading && (
          <>
            {/* STATE - Hasn't reached remote server */}
            {!hasReachedRemoteServer && (
              <>
                {window.USE_SECRET && (
                  <div className="login-state">
                    <div className="icon-wrapper">
                      <img src={`/logo.png`} alt="Erin logo" />
                    </div>
                    <h1>我的短视频</h1>
                    <p>输入密码，开始浏览 NAS 视频</p>
                    <form onSubmit={attemptToReachRemoteServer}>
                      <label htmlFor="password">密码</label>
                      <input
                        id="password"
                        name="password"
                        type="password"
                        placeholder="请输入密码"
                        onInput={handleInputSecret}
                      />
                      <button type="submit">进入视频库</button>
                      {hasEverSubmitted && (
                        <p className="form-error">密码错误</p>
                      )}
                    </form>
                  </div>
                )}
              </>
            )}

            {hasReachedRemoteServer && (
              <div className="feed-topbar">
                <button
                  type="button"
                  className="feed-topbar-action"
                  aria-label={feedMode === "favorites" && favoritesPlaying ? "返回收藏列表" : "打开视频目录"}
                  onClick={feedMode === "favorites" && favoritesPlaying ? backToFavorites : openPlaylistsViewer}
                >
                  {feedMode === "favorites" && favoritesPlaying ? <span aria-hidden="true">‹</span> : <FontAwesomeIcon icon={faFolderOpen} />}
                </button>
                <div className="feed-mode-tabs" role="tablist" aria-label="视频分类">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedMode === "recommended"}
                    className={feedMode === "recommended" ? "active" : ""}
                    onClick={() => switchFeedMode("recommended")}
                  >
                    推荐
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedMode === "favorites"}
                    className={feedMode === "favorites" ? "active" : ""}
                    onClick={() => switchFeedMode("favorites")}
                  >
                    收藏
                  </button>
                </div>
                <button
                  type="button"
                  className="feed-topbar-action"
                  style={feedMode === "favorites" && !favoritesPlaying ? { visibility: "hidden" } : undefined}
                  aria-label={isPlaying ? "暂停视频" : "播放视频"}
                  onClick={togglePlayPause}
                  disabled={visibleVideos.length === 0 || (feedMode === "favorites" && !favoritesPlaying)}
                >
                  <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
                </button>
              </div>
            )}

            {/* STATE - Reached remote server but no media was found */}
            {hasReachedRemoteServer && visibleVideos.length === 0 && (
              <div className="empty-state">
                <h1>{feedMode === "favorites" ? "还没有收藏视频" : "没有找到视频"}</h1>
                <p>
                  {feedMode === "favorites"
                    ? "双击视频，或点右侧爱心收藏"
                    : "请检查视频目录后重试"}
                </p>
                <button
                  type="button"
                  onClick={feedMode === "favorites" ? () => switchFeedMode("recommended") : _reloadPage}
                >
                  {feedMode === "favorites" ? "返回推荐" : "刷新"}
                </button>

                {_getBlacklist().length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn-alternate"
                      onClick={openBlacklist}
                    >
                      管理已隐藏视频
                    </button>
                  </>
                )}
              </div>
            )}

            {hasReachedRemoteServer && feedMode === "favorites" && !favoritesPlaying && favoriteVideos.length > 0 && <FavoritesGallery videos={favoriteVideos} onPlay={openFavoriteVideo} returnPosition={favoriteReturnPosition.current} />}
            {/* STATE - Reached remote server and retrieved media */}
            {hasReachedRemoteServer && visibleVideos.length > 0 && (feedMode !== "favorites" || favoritesPlaying) && (
              <>
                {Feed}
                {visibleVideos[currentVideoIndex] && (
                  <BottomMetadata
                    video={visibleVideos[currentVideoIndex]}
                    extraMetadata={currentVideoMetadata}
                    person={currentPerson}
                    onOpenPerson={() => openPeoplePanel(currentPerson ? "profile" : "list", currentPerson?.id)}
                  />
                )}
                <SideControls
                  onShare={share}
                  onFavorite={() => updateFavorites(visibleVideos[currentVideoIndex])}
                  isFavorite={
                    !!visibleVideos[currentVideoIndex] &&
                    favorites.has(favoriteId(visibleVideos[currentVideoIndex]))
                  }
                  onToggleMute={toggleMute}
                  isMuted={muted}
                  playbackSpeed={playbackSpeed}
                  onCyclePlaybackSpeed={cyclePlaybackSpeed}
                  onDelete={() => requestDelete(mainVideo)}
                  onDownload={download}
                  onBlacklist={blacklist}
                  onOpenBlacklist={openBlacklist}
                  person={currentPerson}
                  onOpenPerson={() => openPeoplePanel(currentPerson ? "profile" : "list", currentPerson?.id)}
                  onAddPerson={() => openPeoplePanel("picker")}
                />
              </>
            )}
            {hasReachedRemoteServer && (
              <>
                <BlacklistManager
                  visible={blacklistOpen}
                  videos={_getBlacklist()}
                  onClose={hideBlacklist}
                  onUnmask={removeFromBlacklist}
                />
                <PlaylistsViewer
                  visible={playlistsViewerOpen}
                  playlists={playlists}
                  onClose={hidePlaylistsViewer}
                  onOpenPlaylistGallery={openPlaylistGallery}
                  onRefreshIndex={refreshIndex}
                  indexRefreshing={indexRefreshing}
                  indexMessage={indexMessage}
                  onUpload={() => { feedRef.current?.pausePlayback(); setUploadPersonId(""); }}
                />
                <PlaylistGallery
                  visible={playlistGalleryOpen}
                  activePlaylist={activePlaylistForGallery}
                  onClose={hidePlaylistGallery}
                />
                <PeopleManager
                  panel={peoplePanel}
                  people={people}
                  assignments={assignments}
                  allVideos={allVideos}
                  currentVideo={mainVideo}
                  busy={peopleBusy}
                  error={peopleError}
                  onClose={closePeoplePanel}
                  onList={() => setPeoplePanel({ view: "list" })}
                  onProfile={(personId) => setPeoplePanel({ view: "profile", personId })}
                  onAssign={assignPerson}
                  onRemove={removePersonVideo}
                  onTransfer={transferPersonVideo}
                  onCreate={createPerson}
                  onUpdate={updatePerson}
                  onPlay={openPersonPlayback}
                  returnPosition={personReturnPosition}
                  onUpload={setUploadPersonId}
                />
                {uploadPersonId !== null && <VideoUploader people={people} initialPersonId={uploadPersonId} hash={secureHash}
                  onClose={() => { setUploadPersonId(null); if (!peoplePanel && !playlistsViewerOpen) feedRef.current?.playPlayback(); }}
                  onUploaded={async () => {
                    const response = await fetch(peopleEndpoint(secureHash), { cache: "no-store" });
                    if (!response.ok) throw new Error("文件已保存，请刷新页面查看人物视频");
                    const data = await response.json(); peopleDataRef.current = data; setPeopleData(data);
                    setCurrentVideoIndex(0); setFeedRevision((value) => value + 1);
                    await retrieveVideos(false);
                  }} />}
                {personPlayback && (
                  <div className="person-player">
                    <VideoFeed
                      key={personPlayback.person.id}
                      ref={personFeedRef}
                      videos={personPlayback.videos}
                      initialIndex={0}
                      startAtIndex={personPlayback.initialIndex}
                      muted={muted}
                      playbackSpeed={playbackSpeed}
                      onFocusVideo={(_, index) => setPersonPlaybackIndex(index)}
                      onFinishVideo={() => {}}
                      onPlaybackStateChange={() => {}}
                      onDoubleTap={(video) => updateFavorites(video, "add")}
                    />
                    <div className="person-player-topbar">
                      <button type="button" onClick={closePersonPlayback} aria-label="返回人物主页">‹</button>
                      <strong>{personPlayback.person.name}</strong>
                      <span>{personPlaybackIndex + 1} / {personPlayback.videos.length}</span>
                    </div>
                    {personPlayback.videos[personPlaybackIndex] && (
                      <>
                        <BottomMetadata video={personPlayback.videos[personPlaybackIndex]} extraMetadata={{ channel_name: personPlayback.person.name }} person={personPlayback.person} onOpenPerson={closePersonPlayback} />
                        <SideControls
                          onShare={() => shareVideo(personPlayback.videos[personPlaybackIndex])}
                          onFavorite={() => updateFavorites(personPlayback.videos[personPlaybackIndex])}
                          isFavorite={favorites.has(videoId(personPlayback.videos[personPlaybackIndex]))}
                          onToggleMute={toggleMute}
                          isMuted={muted}
                          playbackSpeed={playbackSpeed}
                          onCyclePlaybackSpeed={cyclePlaybackSpeed}
                          onDelete={() => requestDelete(personPlayback.videos[personPlaybackIndex])}
                          onDownload={() => downloadVideo(personPlayback.videos[personPlaybackIndex])}
                          person={personPlayback.person}
                          onOpenPerson={closePersonPlayback}
                          showBlacklist={false}
                        />
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
        {deleteTarget && <div className="share-dialog-backdrop delete-dialog-backdrop" onClick={(event) => event.stopPropagation()}>
          <div className="share-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-video-title">
            <h2 id="delete-video-title">彻底删除视频？</h2>
            <p className="delete-video-name">{deleteTarget.filename}</p>
            <p>将删除 NAS 原文件，同时移除收藏和人物归类。无法通过本网页恢复。</p>
            {deleteError && <p role="alert">{deleteError}</p>}
            <div className="delete-dialog-actions">
              <button type="button" disabled={deleteBusy} onClick={() => { setDeleteTarget(null); if (personPlayback) personFeedRef.current?.playPlayback(); else feedRef.current?.playPlayback(); }}>取消</button>
              <button type="button" className="delete-confirm" disabled={deleteBusy || peopleBusy} onClick={confirmDelete}>{deleteBusy ? "删除中…" : "彻底删除"}</button>
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
};

export default App;
