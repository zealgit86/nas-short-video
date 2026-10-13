import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { formatDuration } from "../../videoInfo";
import MediaCard from "../MediaCard";
import "./index.css";

const VideoFeed = forwardRef(
  (
    {
      videos,
      initialIndex,
      startAtIndex,
      jumpToEnd,
      jumpBackForward,
      muted,
      playbackSpeed = 1,
      onFocusVideo,
      onFinishVideo,
      onPlaybackStateChange,
      onDoubleTap,
    },
    ref,
  ) => {
  const _bufferSize = 3;
  const exactStart = startAtIndex !== undefined;
  const normalizedInitialIndex =
    exactStart ? Math.max(0, Math.min(startAtIndex, videos.length - 1)) : _bufferSize === videos.length ? 0 : initialIndex;
  const initialWindowStart = exactStart
    ? Math.max(0, Math.min(normalizedInitialIndex - 1, videos.length - _bufferSize))
    : normalizedInitialIndex;

  // Member - Track the currently-visible media item (0-indexed)
  const currentMediaIndex = useRef(normalizedInitialIndex);

  // Member - Track the currently-visible stable card wrapper
  const currentMediaCard = useRef(null);

  // Member - References to feed UI elements
  const feedRef = useRef();
  const progressRef = useRef();
  const padRef = useRef();
  const scrubberRef = useRef();

  // Member - Save the three stable card wrappers in recycler order
  const cardRefs = useRef([]);
  const saveCardRef = (index) => (card) => {
    cardRefs.current[index] = card;
  };

  // Member - Image timeline and video listener state
  const imageAnimationFrame = useRef(null);
  const imageTimelineGeneration = useRef(0);
  const imageElapsedMs = useRef(0);
  const imageStartedAt = useRef(null);
  const imageIsPlaying = useRef(false);
  const videoListeners = useRef(new Map());
  const wasPlayingBeforeScrub = useRef(false);
  const isScrubbing = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;

  // Member - Current scroll direction
  const _scrollDirection = document
    .querySelector("html")
    .getAttribute("data-scroll-direction");

  // Member - Prevent double jump forward
  const hasJumpedForward = useRef(false);

  const lastTap = useRef({ time: 0, x: 0, y: 0 });
  const tapTimer = useRef(null);
  const holdRef = useRef(null);
  const suppressTapUntil = useRef(0);
  const [heartBurst, setHeartBurst] = useState(0);
  const [speedActive, setSpeedActive] = useState(false);
  const [scrubTime, setScrubTime] = useState(null);

  const imageDurationMs = window.IMAGE_DISPLAY_DURATION * 1000;

  const setProgress = (elapsed, duration) => {
    if (!progressRef.current || !Number.isFinite(duration) || duration <= 0)
      return;

    const progressRate = Math.max(0, Math.min(1, elapsed / duration));
    const timeLabel = `${formatDuration(elapsed)} / ${formatDuration(duration)}`;
    progressRef.current.parentElement.setAttribute("aria-valuetext", timeLabel);
    if (isScrubbing.current) setScrubTime(timeLabel);
    progressRef.current.style.width = `${progressRate * 100}%`;
    progressRef.current.parentElement.setAttribute(
      "aria-valuenow",
      String(Math.round(progressRate * 100)),
    );
  };

  const isFocusedCard = (card, index) =>
    currentMediaCard.current === card &&
    currentMediaIndex.current === index &&
    parseInt(card.dataset.index) === index;

  const isCardVisible = (card) => {
    if (!feedRef.current) return false;

    const cardRect = card.getBoundingClientRect();
    const feedRect = feedRef.current.getBoundingClientRect();
    if (_scrollDirection === "horizontal") {
      const visibleWidth =
        Math.min(cardRect.right, feedRect.right) -
        Math.max(cardRect.left, feedRect.left);
      return visibleWidth / cardRect.width >= 0.95;
    }

    const visibleHeight =
      Math.min(cardRect.bottom, feedRect.bottom) -
      Math.max(cardRect.top, feedRect.top);
    return visibleHeight / cardRect.height >= 0.95;
  };

  const stopImageTimeline = (freeze = true) => {
    imageTimelineGeneration.current += 1;
    if (imageAnimationFrame.current !== null) {
      cancelAnimationFrame(imageAnimationFrame.current);
      imageAnimationFrame.current = null;
    }

    if (freeze && imageIsPlaying.current && imageStartedAt.current !== null) {
      imageElapsedMs.current = Math.min(
        imageDurationMs,
        imageElapsedMs.current + performance.now() - imageStartedAt.current,
      );
    }

    imageStartedAt.current = null;
    imageIsPlaying.current = false;
  };

  const startImageTimeline = (reset = false) => {
    const card = currentMediaCard.current;
    const index = currentMediaIndex.current;
    if (!card || card.dataset.mediaType !== "image") return;

    stopImageTimeline(false);
    if (reset) imageElapsedMs.current = 0;

    imageIsPlaying.current = true;
    imageStartedAt.current = performance.now();
    onPlaybackStateChange(true);

    const generation = imageTimelineGeneration.current;
    const tick = (now) => {
      if (
        generation !== imageTimelineGeneration.current ||
        !isFocusedCard(card, index) ||
        card.dataset.mediaType !== "image"
      )
        return;

      const elapsed = imageElapsedMs.current + now - imageStartedAt.current;
      if (elapsed >= imageDurationMs) {
        stopImageTimeline(false);
        imageElapsedMs.current = 0;
        setProgress(0, imageDurationMs);
        onFinishVideo();

        if (isFocusedCard(card, index) && card.dataset.mediaType === "image")
          startImageTimeline();
        return;
      }

      setProgress(elapsed, imageDurationMs);
      imageAnimationFrame.current = requestAnimationFrame(tick);
    };

    imageAnimationFrame.current = requestAnimationFrame(tick);
  };

  const removeVideoListeners = (video) => {
    const listeners = videoListeners.current.get(video);
    if (!listeners) return;

    Object.entries(listeners).forEach(([eventName, listener]) => {
      video.removeEventListener(eventName, listener, true);
    });
    videoListeners.current.delete(video);
  };

  const releaseSpeedHold = (suppressClick = false) => {
    const hold = holdRef.current;
    if (!hold) return;
    clearTimeout(hold.timer);
    if (hold.active) {
      hold.video.playbackRate = hold.previousRate;
      setSpeedActive(false);
    }
    if (suppressClick)
      suppressTapUntil.current = Date.now() + 550;
    holdRef.current = null;
  };

  const stopCardPlayback = (card) => {
    if (!card) return;

    const video = card.querySelector("video");
    if (holdRef.current?.video === video) releaseSpeedHold();
    removeVideoListeners(video);
    video.pause();

    if (currentMediaCard.current === card && card.dataset.mediaType === "image")
      stopImageTimeline();
  };

  // Assign both initial and recycled cards through the same cleanup and loading path.
  const assignMedia = (card, index) => {
    if (!card) return;

    stopCardPlayback(card);

    const video = card.querySelector("video");
    const image = card.querySelector("img");
    video.removeAttribute("src");
    video.load();
    image.removeAttribute("src");

    const media = videos[index];
    card.dataset.index = index;
    card.dataset.mediaType = media ? media.type : "";
    video.hidden = !media || media.type !== "video";
    image.hidden = !media || media.type !== "image";

    if (!media) return;

    let safeUrl = media.url;
    try {
      safeUrl = media.url.replace(
        media.filename,
        encodeURIComponent(media.filename),
      );
    } catch (error) {
      console.error("Invalid URL in MediaCard:", media, error);
    }

    if (media.type === "image") {
      image.alt = media.title;
      image.src = safeUrl;
    } else {
      video.muted = mutedRef.current;
      video.playbackRate = playbackSpeedRef.current;
      video.src = safeUrl;
    }
  };

  const focusCard = (card, index) => {
    if (!videos[index] || parseInt(card.dataset.index) !== index) return;
    if (isFocusedCard(card, index)) return;

    const previousCard = currentMediaCard.current;
    if (previousCard) stopCardPlayback(previousCard);

    currentMediaCard.current = card;
    currentMediaIndex.current = index;
    setProgress(0, 1);
    onFocusVideo(videos[index], index);

    if (card.dataset.mediaType === "image") {
      imageElapsedMs.current = 0;
      startImageTimeline(true);
      return;
    }

    const video = card.querySelector("video");
    video.muted = mutedRef.current;
    video.playbackRate = playbackSpeedRef.current;

    const listeners = {
      timeupdate: (event) => {
        if (!isFocusedCard(card, index)) return;
        setProgress(event.target.currentTime, event.target.duration);
      },
      ended: (event) => {
        if (!isFocusedCard(card, index)) return;
        event.target.play().catch((_) => {
          if (isFocusedCard(card, index)) onPlaybackStateChange(false);
        });
        onFinishVideo();
      },
      play: () => {
        if (isFocusedCard(card, index)) onPlaybackStateChange(true);
      },
      pause: () => {
        if (isFocusedCard(card, index)) onPlaybackStateChange(false);
      },
    };

    if (window.VIDEO_START_POSITION !== "start") {
      listeners.loadedmetadata = (event) => {
        if (!isFocusedCard(card, index)) return;
        event.target.currentTime =
          window.VIDEO_START_POSITION === "middle"
            ? event.target.duration / 2
            : Math.random() * event.target.duration;
        event.target.removeEventListener(
          "loadedmetadata",
          listeners.loadedmetadata,
          true,
        );
      };
    }

    Object.entries(listeners).forEach(([eventName, listener]) => {
      video.addEventListener(eventName, listener, true);
    });
    videoListeners.current.set(video, listeners);

    if (listeners.loadedmetadata && video.readyState >= 1)
      listeners.loadedmetadata({ target: video });

    video.play().catch((_) => {
      if (isFocusedCard(card, index)) onPlaybackStateChange(false);
    });
  };

  const pausePlayback = () => {
    const card = currentMediaCard.current;
    if (!card) return;

    if (card.dataset.mediaType === "image") {
      stopImageTimeline();
      setProgress(imageElapsedMs.current, imageDurationMs);
      onPlaybackStateChange(false);
    } else {
      card.querySelector("video").pause();
    }
  };

  const playPlayback = () => {
    const card = currentMediaCard.current;
    if (!card) return;

    if (card.dataset.mediaType === "image") {
      if (imageElapsedMs.current >= imageDurationMs) imageElapsedMs.current = 0;
      startImageTimeline();
    } else {
      const video = card.querySelector("video");
      const index = currentMediaIndex.current;
      video.play().catch((_) => {
        if (isFocusedCard(card, index)) onPlaybackStateChange(false);
      });
    }
  };

  const togglePlayback = () => {
    const card = currentMediaCard.current;
    if (!card) return;

    if (card.dataset.mediaType === "image") {
      if (imageIsPlaying.current) pausePlayback();
      else playPlayback();
      return;
    }

    const video = card.querySelector("video");
    if (video.paused) playPlayback();
    else pausePlayback();
  };

  useImperativeHandle(ref, () => ({
    togglePlayback,
    pausePlayback: () => pausePlayback(),
    playPlayback: () => playPlayback(),
  }));

  // Hook - Keep the global mute setting applied to the focused video.
  useEffect(() => {
    const card = currentMediaCard.current;
    if (card && card.dataset.mediaType === "video")
      card.querySelector("video").muted = muted;
  }, [muted]);

  // Apply the selected speed without resetting the current video or its position.
  useEffect(() => {
    const card = currentMediaCard.current;
    if (!card || card.dataset.mediaType !== "video") return;
    const video = card.querySelector("video");
    const hold = holdRef.current;
    if (hold?.video === video && hold.active)
      hold.previousRate = playbackSpeed;
    else
      video.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Hook - On mount - Set the current scroll. A favorite or mute update must
  // never replay this one-time jump on the already-mounted feed.
  useEffect(() => {
    if (exactStart) return;
    if (jumpToEnd)
      return feedRef.current.scrollBy(
        _scrollDirection === "vertical"
          ? { top: 1, left: 0 }
          : { top: 0, left: 1 },
      );
    if (jumpBackForward) {
      if (!hasJumpedForward.current) {
        hasJumpedForward.current = true;
        return feedRef.current.scrollBy(
          _scrollDirection === "vertical"
            ? { top: 1, left: 0 }
            : { top: 0, left: 1 },
        );
      }

      hasJumpedForward.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hook - When media are loaded - Set up the stable-card scroll observer
  useEffect(() => {
    cardRefs.current.forEach((card, offset) => {
      assignMedia(card, initialWindowStart + offset);
    });
    if (exactStart && cardRefs.current[0]) {
      const rect = cardRefs.current[0].getBoundingClientRect();
      if (_scrollDirection === "vertical") {
        padRef.current.style.height = `${initialWindowStart * rect.height}px`;
        feedRef.current.scrollTop = normalizedInitialIndex * rect.height;
      } else {
        padRef.current.style.width = `${initialWindowStart * rect.width}px`;
        feedRef.current.scrollLeft = normalizedInitialIndex * rect.width;
      }
      currentMediaIndex.current = normalizedInitialIndex;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let visibleEntry = null;

        entries.forEach((entry) => {
          const index = parseInt(entry.target.dataset.index);
          if (
            entry.isIntersecting &&
            isCardVisible(entry.target) &&
            videos[index] &&
            entry.target.dataset.mediaType === videos[index].type
          ) {
            visibleEntry = entry;
          } else if (
            !entry.isIntersecting &&
            currentMediaCard.current === entry.target
          ) {
            stopCardPlayback(entry.target);
            currentMediaCard.current = null;
          }
        });

        if (!visibleEntry) return;

        const card = visibleEntry.target;
        const currentIndex = parseInt(card.dataset.index);
        const previousIndex = currentMediaIndex.current;
        focusCard(card, currentIndex);

        if (videos.length <= 1 || previousIndex === currentIndex) return;

        const scrollDirection = currentIndex > previousIndex ? "next" : "prev";
        const cardRect = cardRefs.current[1].getBoundingClientRect();
        const padHeight = cardRect.height * (currentIndex - 1);
        const padWidth = cardRect.width * (currentIndex - 1);

        if (scrollDirection === "next") {
          if (currentIndex > 1 && currentIndex < videos.length - 1) {
            const firstCard = cardRefs.current.shift();
            cardRefs.current.push(firstCard);

            if (_scrollDirection === "vertical")
              padRef.current.style.height = `${padHeight}px`;
            else padRef.current.style.width = `${padWidth}px`;

            cardRefs.current[_bufferSize - 2].insertAdjacentElement(
              "afterend",
              firstCard,
            );
            assignMedia(firstCard, currentIndex + 1);
          }
        } else if (previousIndex > 1 && previousIndex < videos.length - 1) {
          const lastCard = cardRefs.current.at(-1);
          cardRefs.current.unshift(lastCard);
          cardRefs.current.splice(-1);

          cardRefs.current[1].insertAdjacentElement("beforebegin", lastCard);

          if (_scrollDirection === "vertical")
            padRef.current.style.height = `${padHeight}px`;
          else padRef.current.style.width = `${padWidth}px`;

          assignMedia(lastCard, currentIndex - 1);
        }
      },
      { root: null, rootMargin: "0px", threshold: 0.95 },
    );

    const observedCards = cardRefs.current.slice();
    observedCards.forEach((card) => {
      if (card) observer.observe(card);
    });

    return () => {
      observer.disconnect();
      stopImageTimeline(false);
      observedCards.forEach((card) => stopCardPlayback(card));
      currentMediaCard.current = null;
    };
  }, [videos]); // eslint-disable-line react-hooks/exhaustive-deps

  const seekBy = (seconds) => {
    const card = currentMediaCard.current;
    if (!card) return;

    if (card.dataset.mediaType === "image") {
      const currentElapsed = imageIsPlaying.current
        ? imageElapsedMs.current + performance.now() - imageStartedAt.current
        : imageElapsedMs.current;
      imageElapsedMs.current = Math.max(
        0,
        Math.min(imageDurationMs, currentElapsed + seconds * 1000),
      );
      if (imageIsPlaying.current) imageStartedAt.current = performance.now();
      setProgress(imageElapsedMs.current, imageDurationMs);
      return;
    }

    const video = card.querySelector("video");
    video.currentTime += seconds;
  };

  const handleKeyboardSeeking = (event) => {
    if (event.code === "ArrowRight") seekBy(5);
    else if (event.code === "ArrowLeft") seekBy(-5);
    else if (
      event.code === "Space" &&
      !["BUTTON", "INPUT", "TEXTAREA"].includes(event.target.tagName)
    ) {
      event.preventDefault();
      togglePlayback();
    }
    else if (event.code === "ArrowDown")
      feedRef.current.scrollBy(
        _scrollDirection === "vertical"
          ? { top: 1, left: 0, behavior: "smooth" }
          : { top: 0, left: 1, behavior: "smooth" },
      );
    else if (event.code === "ArrowUp")
      feedRef.current.scrollBy(
        _scrollDirection === "vertical"
          ? { top: -1, left: 0, behavior: "smooth" }
          : { top: 0, left: -1, behavior: "smooth" },
      );
  };

  const handleMediaTap = (event) => {
    const now = Date.now();
    if (now < suppressTapUntil.current) return;
    const prior = lastTap.current;
    const nearby =
      Math.abs(event.clientX - prior.x) < 48 &&
      Math.abs(event.clientY - prior.y) < 48;

    if (now - prior.time < 320 && nearby) {
      clearTimeout(tapTimer.current);
      lastTap.current.time = 0;
      onDoubleTap?.(videos[currentMediaIndex.current]);
      setHeartBurst((burst) => burst + 1);
      return;
    }

    lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      lastTap.current.time = 0;
      togglePlayback();
    }, 320);
  };

  const handleHoldStart = (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const card = event.currentTarget;
    if (card !== currentMediaCard.current || card.dataset.mediaType !== "video")
      return;
    const video = card.querySelector("video");
    if (video.paused) return;

    releaseSpeedHold();
    const hold = {
      pointerId: event.pointerId,
      video,
      card,
      x: event.clientX,
      y: event.clientY,
      previousRate: video.playbackRate,
      active: false,
      timer: null,
    };
    hold.timer = setTimeout(() => {
      if (holdRef.current !== hold || currentMediaCard.current !== card)
        return;
      try {
        video.playbackRate = 2;
        hold.active = true;
        setSpeedActive(true);
        clearTimeout(tapTimer.current);
        lastTap.current.time = 0;
      } catch {
        holdRef.current = null;
      }
    }, 450);
    holdRef.current = hold;
  };

  const handleHoldMove = (event) => {
    const hold = holdRef.current;
    if (!hold || hold.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 14)
      releaseSpeedHold(true);
  };

  const handleHoldEnd = (event) => {
    const hold = holdRef.current;
    if (hold?.pointerId === event.pointerId)
      releaseSpeedHold(hold.active);
  };

  const handleHoldCancel = (event) => {
    if (holdRef.current?.pointerId === event.pointerId)
      releaseSpeedHold();
  };

  const handleHoldContextMenu = (event) => {
    if (holdRef.current || Date.now() < suppressTapUntil.current)
      event.preventDefault();
  };

  const handleScrubStart = (event) => {
    event.preventDefault();
    event.stopPropagation();
    releaseSpeedHold();
    isScrubbing.current = true;
    setScrubTime("时间加载中…");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrubberRef.current.classList.add("is-dragged");
    const card = currentMediaCard.current;
    if (!card) return;

    wasPlayingBeforeScrub.current =
      card.dataset.mediaType === "image"
        ? imageIsPlaying.current
        : !card.querySelector("video").paused;
    pausePlayback();
    handleScrubDrag(event, true);
  };

  const handleScrubDrag = (event, force = false) => {
    if (!isScrubbing.current && !force) return;
    const card = currentMediaCard.current;
    if (!card) return;

    const duration =
      card.dataset.mediaType === "image"
        ? window.IMAGE_DISPLAY_DURATION
        : card.querySelector("video").duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    let mappedTime = ((event.clientX - left) * duration) / width;
    mappedTime = Math.max(0, Math.min(duration, mappedTime));

    if (card.dataset.mediaType === "image")
      imageElapsedMs.current = mappedTime * 1000;
    else card.querySelector("video").currentTime = mappedTime;

    setProgress(mappedTime, duration);
  };

  const handleScrubEnd = () => {
    if (!isScrubbing.current) return;
    isScrubbing.current = false;
    setScrubTime(null);
    scrubberRef.current.classList.remove("is-dragged");
    if (wasPlayingBeforeScrub.current) playPlayback();
  };

  useEffect(() => {
    const releaseOnBlur = () => releaseSpeedHold();
    const releaseWhenHidden = () => {
      if (document.visibilityState === "hidden") releaseSpeedHold();
    };
    document.addEventListener("keydown", handleKeyboardSeeking);
    window.addEventListener("blur", releaseOnBlur);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      document.removeEventListener("keydown", handleKeyboardSeeking);
      window.removeEventListener("blur", releaseOnBlur);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
      clearTimeout(tapTimer.current);
      releaseSpeedHold();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={feedRef} className="feed">
      <div ref={padRef} className="feed-pad-top"></div>
      {[...Array(Math.min(_bufferSize, videos.length)).keys()].map((slot) => (
        <MediaCard
          key={slot}
          onClick={handleMediaTap}
          onPointerDown={handleHoldStart}
          onPointerMove={handleHoldMove}
          onPointerUp={handleHoldEnd}
          onPointerCancel={handleHoldCancel}
          onPointerLeave={handleHoldCancel}
          onContextMenu={handleHoldContextMenu}
          refForwarder={saveCardRef(slot)}
        />
      ))}
      {speedActive && (
        <div className="speed-indicator" role="status" aria-live="polite">
          <strong>2×</strong> 快进中 · 松手恢复
        </div>
      )}
      {heartBurst > 0 && (
        <div key={heartBurst} className="double-tap-heart" aria-hidden="true">
          ♥
        </div>
      )}
      <div
        className={`video-track ${window.PROGRESS_BAR_POSITION}`}
        onPointerDown={handleScrubStart}
        onPointerMove={handleScrubDrag}
        onPointerUp={handleScrubEnd}
        onPointerCancel={handleScrubEnd}
        role="slider"
        aria-label="视频进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        tabIndex={0}
      >
        {scrubTime !== null && <span className="scrub-time-indicator" role="status">{scrubTime}</span>}
        <div className="video-track-progress" ref={progressRef}>
          <span ref={scrubberRef} className="video-track-scrubber" />
        </div>
      </div>
    </div>
  );
  },
);

export default VideoFeed;
