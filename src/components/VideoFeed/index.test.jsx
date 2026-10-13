import { act } from "react";
import { createRoot } from "react-dom/client";
import VideoFeed from ".";

const sampleVideos = [
  { type: "video", title: "test", filename: "test.mp4", url: "/test.mp4" },
];

const pointer = (node, type, x = 20, y = 20) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  act(() => node.dispatchEvent(event));
};

describe("hold to play at 2×", () => {
  let root;
  let host;
  let originalPaused;
  let originalIntersectionObserver;
  let originalRect;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    document.documentElement.setAttribute("data-scroll-direction", "vertical");
    window.IMAGE_DISPLAY_DURATION = 5;
    window.VIDEO_START_POSITION = "start";
    window.PROGRESS_BAR_POSITION = "bottom";

    originalPaused = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "paused",
    );
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() { return this._testPaused ?? true; },
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
      this._testPaused = false;
      return Promise.resolve();
    });
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function () {
      this._testPaused = true;
    });
    jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    originalIntersectionObserver = global.IntersectionObserver;
    global.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(card) {
        if (card.dataset.index === "0")
          this.callback([{ target: card, isIntersecting: true }]);
      }
      disconnect() {}
    };
    originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100,
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(
      <VideoFeed
        videos={sampleVideos}
        initialIndex={0}
        muted={true}
        onFocusVideo={() => {}}
        onFinishVideo={() => {}}
        onPlaybackStateChange={() => {}}
      />,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    jest.restoreAllMocks();
    Object.defineProperty(HTMLMediaElement.prototype, "paused", originalPaused);
    global.IntersectionObserver = originalIntersectionObserver;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    jest.useRealTimers();
  });

  test("scrubbing shows current/total time, clamps bounds, and resumes only previous playback", () => {
    const video = host.querySelector("video");
    Object.defineProperty(video, "duration", { configurable: true, value: 125 });
    const track = host.querySelector(".video-track");
    pointer(track, "pointerdown", 20);
    expect(video.paused).toBe(true);
    expect(host.querySelector(".scrub-time-indicator").textContent).toBe("00:25 / 02:05");
    pointer(track, "pointermove", 80);
    expect(video.currentTime).toBe(100);
    expect(track.getAttribute("aria-valuetext")).toBe("01:40 / 02:05");
    pointer(track, "pointermove", 150);
    expect(video.currentTime).toBe(125);
    pointer(track, "pointerup");
    expect(host.querySelector(".scrub-time-indicator")).toBeNull();
    expect(video.paused).toBe(false);
    video.pause();
    pointer(track, "pointerdown", -10);
    expect(video.currentTime).toBe(0);
    pointer(track, "pointercancel");
    expect(video.paused).toBe(true);
  });

  test("holds at 2×, restores on release, and does not pause on the resulting click", () => {
    const card = host.querySelector(".media");
    const video = card.querySelector("video");
    expect(video.paused).toBe(false);

    pointer(card, "pointerdown");
    act(() => jest.advanceTimersByTime(449));
    expect(video.playbackRate).toBe(1);
    act(() => jest.advanceTimersByTime(1));
    expect(video.playbackRate).toBe(2);
    expect(host.querySelector(".speed-indicator")).not.toBeNull();

    pointer(card, "pointerup");
    expect(video.playbackRate).toBe(1);
    expect(host.querySelector(".speed-indicator")).toBeNull();
    act(() => card.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => jest.advanceTimersByTime(320));
    expect(video.paused).toBe(false);
  });

  test("moving to swipe cancels the hold before changing speed", () => {
    const card = host.querySelector(".media");
    const video = card.querySelector("video");
    pointer(card, "pointerdown");
    pointer(card, "pointermove", 20, 45);
    act(() => jest.advanceTimersByTime(500));
    expect(video.playbackRate).toBe(1);
    expect(host.querySelector(".speed-indicator")).toBeNull();
  });

  test("a cancelled touch restores normal speed", () => {
    const card = host.querySelector(".media");
    const video = card.querySelector("video");
    pointer(card, "pointerdown");
    act(() => jest.advanceTimersByTime(450));
    expect(video.playbackRate).toBe(2);
    pointer(card, "pointercancel");
    expect(video.playbackRate).toBe(1);
    expect(host.querySelector(".speed-indicator")).toBeNull();
  });

  test("the selected speed takes effect without restarting playback and survives a hold", () => {
    const card = host.querySelector(".media");
    const video = card.querySelector("video");
    act(() => root.render(
      <VideoFeed
        videos={sampleVideos}
        initialIndex={0}
        muted={true}
        playbackSpeed={1.5}
        onFocusVideo={() => {}}
        onFinishVideo={() => {}}
        onPlaybackStateChange={() => {}}
      />,
    ));
    expect(video.playbackRate).toBe(1.5);
    expect(video.paused).toBe(false);
    pointer(card, "pointerdown");
    act(() => jest.advanceTimersByTime(450));
    expect(video.playbackRate).toBe(2);
    pointer(card, "pointerup");
    expect(video.playbackRate).toBe(1.5);
  });
});
