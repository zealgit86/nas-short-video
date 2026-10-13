"""Small, private JSON store for user-defined video people."""

import json
import math
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

DATA_PATH = os.environ.get("PEOPLE_DATA_PATH", "/srv/appdata/people.json")
LOCK = threading.Lock()
THUMB_LOCK = threading.Semaphore(1)
INFO_LOCK = threading.Semaphore(1)
MAX_BODY = 2_000_000
AVATAR = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
MEDIA_ROOT = os.path.realpath("/srv/videos")
INFO_DIR = os.path.join(os.path.dirname(DATA_PATH), "media-info")
THUMB_DIR = os.path.join(os.path.dirname(DATA_PATH), "thumbnails")
DELETED_PATH = os.path.join(os.path.dirname(DATA_PATH), "deleted-videos.json")
CATALOG_PATH = "/srv/videos/__erin_catalog.json"
LIVE_CATALOG_PATH = os.path.join(os.path.dirname(DATA_PATH), "catalog-current.json")
SCAN_LOCK = threading.Lock()
SCAN_STATUS = {"state": "idle"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".ogg", ".webm"}
UPLOAD_LIMIT = 8 * 1024 ** 3
UPLOAD_SLOTS = threading.Semaphore(2)
UPLOAD_ROOTS = {"library": "/library", "mobile": "/mobile"}


def upload_directory(key):
    if not isinstance(key, str) or len(key) > 2048:
        raise ValueError("目录无效")
    parts = key.split("/")
    if any(not part or part.startswith((".", "@", "#")) or "\\" in part or any(ord(c) < 32 for c in part) for part in parts):
        raise ValueError("目录无效")
    if not any(key == root or key.startswith(root + "/") for root in UPLOAD_ROOTS):
        raise ValueError("请选择两个视频目录内的文件夹")
    path = os.path.join(MEDIA_ROOT, key)
    if os.path.realpath(path) != path or not os.path.isdir(path):
        raise ValueError("目录不存在或不可用")
    return path


def folder_listing(key):
    path = upload_directory(key)
    folders = sorted(entry.name for entry in os.scandir(path) if entry.is_dir(follow_symlinks=False)
                     and not entry.name.startswith((".", "@", "#")))
    root = next(root for root in UPLOAD_ROOTS if key == root or key.startswith(root + "/"))
    return {"directory": key, "displayPath": UPLOAD_ROOTS[root] + key[len(root):],
            "folders": folders, "parent": key.rsplit("/", 1)[0] if key != root else None}


def catalog_path():
    return LIVE_CATALOG_PATH if os.path.exists(LIVE_CATALOG_PATH) else CATALOG_PATH


def scan_sources():
    sources = {}
    for prefix in ("library", "mobile"):
        root = os.path.join(MEDIA_ROOT, prefix)
        if not os.path.isdir(root) or os.path.realpath(root) != root:
            raise OSError("source unavailable")
        files = {}
        def failed(error):
            raise error
        for base, dirs, names in os.walk(root, followlinks=False, onerror=failed):
            dirs[:] = sorted(d for d in dirs if d not in ("@eaDir", "#recycle")
                             and not d.startswith(".") and not os.path.islink(os.path.join(base, d)))
            for name in names:
                path = os.path.join(base, name)
                if name.startswith(".") or os.path.splitext(name)[1].lower() not in VIDEO_EXTENSIONS or os.path.islink(path):
                    continue
                stat = os.stat(path)
                if os.path.isfile(path):
                    files[os.path.relpath(path, root)] = stat.st_size
        sources[prefix] = files
    rows = []
    duplicates = 0
    for prefix, files in sources.items():
        for relative, size in sorted(files.items()):
            rows.append({"name": os.path.basename(relative), "url": prefix + "/" + relative})
    return rows, duplicates


def refresh_index(job_id):
    global SCAN_STATUS
    try:
        with LOCK:
            before = {row["url"] for row in catalog()}
        rows, duplicates = scan_sources()
        with LOCK:
            # Preserve uploads committed after this scan began.
            scanned = {row["url"] for row in rows}
            rows += [row for row in catalog() if row["url"] not in before and row["url"] not in scanned]
            # A video deleted during the scan must not be reintroduced.
            rows = [row for row in rows if os.path.isfile(os.path.join(MEDIA_ROOT, row["url"]))]
            after = {row["url"] for row in rows}
            write_json(LIVE_CATALOG_PATH + ".previous", catalog())
            write_json(LIVE_CATALOG_PATH, rows)
        result = {"state": "complete", "jobId": job_id, "added": len(after - before),
                  "removed": len(before - after), "total": len(after), "duplicatesExcluded": duplicates,
                  "finishedAt": int(time.time())}
    except (OSError, ValueError):
        result = {"state": "failed", "jobId": job_id, "error": "扫描失败，原索引保留，请检查目录后重试"}
    with SCAN_LOCK:
        SCAN_STATUS = result


def read_store():
    try:
        with open(DATA_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            deleted = deleted_ids()
            data["assignments"] = {key: value for key, value in data["assignments"].items() if key not in deleted}
            return data
    except FileNotFoundError:
        return {"revision": 0, "people": [], "assignments": {}}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(data, out, ensure_ascii=False, separators=(",", ":"))
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def deleted_ids():
    try:
        with open(DELETED_PATH, encoding="utf-8") as file:
            ids = json.load(file)
        # A later upload with the same filename is a new video.
        return {key for key in ids if not os.path.exists(os.path.join(MEDIA_ROOT, key))}
    except FileNotFoundError:
        return set()


def catalog():
    with open(catalog_path(), encoding="utf-8") as file:
        rows = json.load(file)
    deleted = deleted_ids()
    return [row for row in rows if row["url"] not in deleted]


CATALOG_ID_CACHE = (None, set())
def known_video(video_id):
    global CATALOG_ID_CACHE
    if video_id in read_store()["assignments"]:
        return True
    path = catalog_path()
    stat = os.stat(path)
    fingerprint = (path, stat.st_size, stat.st_mtime_ns)
    if CATALOG_ID_CACHE[0] != fingerprint:
        with open(path, encoding="utf-8") as file:
            ids = {row["url"] for row in json.load(file)}
        CATALOG_ID_CACHE = (fingerprint, ids)
    return video_id in CATALOG_ID_CACHE[1]


def validate(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("revision"), int):
        return False
    people = payload.get("people")
    assignments = payload.get("assignments")
    if not isinstance(people, list) or len(people) > 500 or not isinstance(assignments, dict):
        return False
    if len(assignments) > 200000:
        return False
    ids = set()
    for person in people:
        if not isinstance(person, dict):
            return False
        identifier, name, avatar = person.get("id"), person.get("name"), person.get("avatar", "")
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-z0-9-]{8,64}", identifier):
            return False
        if identifier in ids or not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
            return False
        if not isinstance(avatar, str) or len(avatar) > 220000 or (avatar and not AVATAR.fullmatch(avatar)):
            return False
        ids.add(identifier)
    return all(
        isinstance(video_id, str) and 1 <= len(video_id) <= 1024 and
        isinstance(person_id, str) and person_id in ids
        for video_id, person_id in assignments.items()
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # The query string contains Erin's existing media access hash.
        pass

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def thumbnail(self, video_id):
        if not video_id or len(video_id) > 1024:
            return self.reply(400, {"error": "invalid_video"})
        with LOCK:
            if not known_video(video_id):
                return self.reply(404, {"error": "not_found"})
        source = os.path.realpath(os.path.join("/srv/videos", video_id))
        if (os.path.commonpath([MEDIA_ROOT, source]) != MEDIA_ROOT or
                os.path.splitext(source)[1].lower() not in VIDEO_EXTENSIONS or
                not os.path.isfile(source)):
            return self.reply(404, {"error": "not_found"})
        os.makedirs(THUMB_DIR, exist_ok=True)
        destination = os.path.join(THUMB_DIR, hashlib.sha256(video_id.encode()).hexdigest() + ".jpg")
        with THUMB_LOCK:
            if not os.path.exists(destination) or os.path.getmtime(destination) < os.path.getmtime(source):
                fd, temporary = tempfile.mkstemp(prefix="thumb-", suffix=".jpg", dir=THUMB_DIR)
                os.close(fd)
                try:
                    result = subprocess.run(
                        ["nice", "-n", "15", "ffmpeg", "-hide_banner", "-loglevel", "error",
                         "-nostdin", "-threads", "1", "-filter_threads", "1", "-ss", "0.2",
                         "-i", source, "-an", "-sn", "-frames:v", "1",
                         "-vf", "scale=240:320:force_original_aspect_ratio=increase,crop=240:320",
                         "-q:v", "8", "-y", temporary],
                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20,
                    )
                    if result.returncode or not os.path.getsize(temporary):
                        return self.reply(422, {"error": "thumbnail_failed"})
                    os.replace(temporary, destination)
                except (OSError, subprocess.TimeoutExpired):
                    return self.reply(503, {"error": "thumbnail_unavailable"})
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
        size = os.path.getsize(destination)
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Cache-Control", "private, max-age=86400")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with open(destination, "rb") as image:
            shutil.copyfileobj(image, self.wfile)

    def video_info(self, video_id):
        if not video_id or len(video_id) > 1024:
            return self.reply(400, {"error": "invalid_video"})
        with LOCK:
            if not known_video(video_id):
                return self.reply(404, {"error": "not_found"})
        source = os.path.realpath(os.path.join(MEDIA_ROOT, video_id))
        if (os.path.commonpath([MEDIA_ROOT, source]) != MEDIA_ROOT or
                os.path.splitext(source)[1].lower() not in VIDEO_EXTENSIONS or
                not os.path.isfile(source)):
            return self.reply(404, {"error": "not_found"})
        try:
            with INFO_LOCK:
                stat = os.stat(source)
                fingerprint = [stat.st_size, stat.st_mtime_ns]
                cache = os.path.join(INFO_DIR, hashlib.sha256(video_id.encode()).hexdigest() + ".json")
                try:
                    with open(cache, encoding="utf-8") as file:
                        info = json.load(file)
                except (OSError, ValueError):
                    info = {}
                if info.get("fingerprint") != fingerprint:
                    result = subprocess.run(
                        ["nice", "-n", "15", "ffprobe", "-v", "error", "-show_entries",
                         "format=duration:stream=duration", "-of", "json", source],
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=12,
                    )
                    duration = None
                    if result.returncode == 0:
                        probe = json.loads(result.stdout)
                        candidates = [probe.get("format", {}).get("duration")] + [stream.get("duration") for stream in probe.get("streams", [])]
                        for value in candidates:
                            try:
                                number = float(value)
                                if math.isfinite(number) and number >= 0:
                                    duration = number
                                    break
                            except (TypeError, ValueError):
                                pass
                    after = os.stat(source)
                    if fingerprint != [after.st_size, after.st_mtime_ns]:
                        return self.reply(503, {"error": "file_changed"})
                    info = {"fingerprint": fingerprint, "duration": duration, "size": stat.st_size}
                    write_json(cache, info)
                return self.reply(200, {"duration": info["duration"], "size": stat.st_size})
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return self.reply(503, {"error": "info_unavailable"})

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/upload/folders":
            try:
                return self.reply(200, folder_listing(parse_qs(parsed.query).get("directory", ["mobile"])[0]))
            except (OSError, ValueError):
                return self.reply(400, {"error": "目录不可用，请重新选择"})
        if parsed.path == "/index/refresh":
            with SCAN_LOCK:
                return self.reply(200, SCAN_STATUS)
        if parsed.path == "/catalog":
            with LOCK:
                return self.reply(200, catalog())
        if parsed.path == "/info":
            return self.video_info(parse_qs(parsed.query).get("video", [""])[0])
        if parsed.path == "/thumb":
            return self.thumbnail(parse_qs(parsed.query).get("video", [""])[0])
        if parsed.path != "/people":
            return self.reply(404, {"error": "not_found"})
        with LOCK:
            self.reply(200, read_store())

    def do_POST(self):
        global SCAN_STATUS
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            return self.reply(403, {"error": "invalid_origin"})
        parsed = urlsplit(self.path)
        if parsed.path == "/upload":
            return self.upload_video(parse_qs(parsed.query))
        if parsed.path == "/upload/folders":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length < 8192:
                    raise ValueError("请求无效")
                payload = json.loads(self.rfile.read(length))
                parent = upload_directory(payload.get("directory"))
                name = payload.get("name")
                if not isinstance(name, str) or not 1 <= len(name) <= 120 or name.startswith((".", "@", "#")) or any(c in name for c in "/\\") or any(ord(c) < 32 for c in name):
                    raise ValueError("请输入有效的文件夹名称")
                os.mkdir(os.path.join(parent, name))
                return self.reply(201, folder_listing(payload["directory"] + "/" + name))
            except FileExistsError:
                return self.reply(409, {"error": "文件夹已存在"})
            except (OSError, ValueError):
                return self.reply(400, {"error": "无法新建文件夹，请检查名称和空间"})
        if parsed.path != "/index/refresh":
            return self.reply(404, {"error": "not_found"})
        # No caller-selected paths or commands; only the two mounted sources.
        with SCAN_LOCK:
            if SCAN_STATUS["state"] != "running":
                job_id = uuid.uuid4().hex
                SCAN_STATUS = {"state": "running", "jobId": job_id, "startedAt": int(time.time())}
                threading.Thread(target=refresh_index, args=(job_id,), daemon=True).start()
            return self.reply(202, SCAN_STATUS)

    def upload_video(self, query):
        if not UPLOAD_SLOTS.acquire(blocking=False):
            return self.reply(409, {"error": "正在处理其他上传，请稍后重试"})
        temporary = None
        final = None
        committed = False
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= UPLOAD_LIMIT:
                return self.reply(413, {"error": "视频为空或超过单个 8 GB 限制"})
            directory = query.get("directory", [""])[0]
            target = upload_directory(directory)
            name = query.get("name", [""])[0]
            person_id = query.get("person", [""])[0]
            if not name or len(name.encode("utf-8")) > 220 or name.startswith(".") or any(c in name for c in "/\\") or any(ord(c) < 32 for c in name) or os.path.splitext(name)[1].lower() not in VIDEO_EXTENSIONS:
                raise ValueError("请选择 MP4、MOV、WEBM 或 OGG 视频")
            with LOCK:
                if person_id not in {person["id"] for person in read_store()["people"]}:
                    raise ValueError("请选择有效人物")
            if shutil.disk_usage(target).free < length + 32 * 1024 ** 2:
                return self.reply(507, {"error": "NAS 剩余空间不足"})
            fd, temporary = tempfile.mkstemp(prefix=".erin-upload-", suffix=".part", dir=target)
            self.connection.settimeout(120)
            with os.fdopen(fd, "wb") as out:
                os.fchmod(out.fileno(), 0o644)
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("上传中断，请重试")
                    out.write(chunk)
                    remaining -= len(chunk)
                out.flush()
                os.fsync(out.fileno())
            with INFO_LOCK:
                probe = subprocess.run(["nice", "-n", "15", "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "json", temporary], capture_output=True, timeout=30, check=True)
            if not json.loads(probe.stdout).get("streams"):
                raise ValueError("文件中没有可读取的视频")
            with LOCK:
                old_people = read_store()
                if person_id not in {person["id"] for person in old_people["people"]}:
                    raise ValueError("人物已被移除，请重新选择")
                # Recheck the folder and create without overwriting existing media.
                upload_directory(directory)
                stem, extension = os.path.splitext(name)
                for attempt in range(10):
                    saved_name = name if attempt == 0 else stem + "-" + uuid.uuid4().hex[:8] + extension
                    candidate = os.path.join(target, saved_name)
                    try:
                        os.link(temporary, candidate)
                        final = candidate
                        break
                    except FileExistsError:
                        continue
                if not final:
                    raise ValueError("无法生成保存名称，请重试")
                key = directory + "/" + saved_name
                old_catalog = catalog()
                updated_catalog = [row for row in old_catalog if row["url"] != key] + [{"name": saved_name, "url": key}]
                updated_people = {**old_people, "revision": old_people["revision"] + 1,
                                  "assignments": {**old_people["assignments"], key: person_id}}
                try:
                    write_json(LIVE_CATALOG_PATH, updated_catalog)
                    write_json(DATA_PATH, updated_people)
                except OSError:
                    write_json(LIVE_CATALOG_PATH, old_catalog)
                    write_json(DATA_PATH, old_people)
                    raise
                committed = True
            return self.reply(201, {"video": key, "name": saved_name, "people": updated_people})
        except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return self.reply(400, {"error": "视频或目标目录无效，上传未完成，请重新选择"})
        except OSError:
            return self.reply(503, {"error": "上传未完成，请检查网络和 NAS 空间后重试"})
        finally:
            for path in (temporary, final if not committed else None):
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
            UPLOAD_SLOTS.release()

    def do_DELETE(self):
        if urlsplit(self.path).path != "/video":
            return self.reply(404, {"error": "not_found"})
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            return self.reply(403, {"error": "invalid_origin"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length < 4096 or self.headers.get("Content-Type") != "application/json":
                return self.reply(400, {"error": "invalid_request"})
            payload = json.loads(self.rfile.read(length))
            key = payload.get("video")
            if payload.get("confirmPermanentDelete") is not True or not isinstance(key, str):
                return self.reply(400, {"error": "confirmation_required"})
            parts = key.split("/")
            if any(part in ("", ".", "..") for part in parts):
                return self.reply(400, {"error": "invalid_video"})
            source = os.path.join(MEDIA_ROOT, key)
            allowed = key.startswith("library/") or key.startswith("mobile/")
            if not allowed or os.path.realpath(source) != source or os.path.splitext(key)[1].lower() not in VIDEO_EXTENSIONS:
                return self.reply(400, {"error": "invalid_video"})
            with LOCK:
                if key not in {row["url"] for row in catalog()}:
                    return self.reply(404, {"error": "not_found"})
                if not os.path.isfile(source):
                    return self.reply(404, {"error": "not_found"})
                # Persist recovery metadata before unlink; failed unlink keeps the file visible.
                ids = deleted_ids() | {key}
                write_json(DELETED_PATH, sorted(ids))
                size = os.path.getsize(source)
                os.unlink(source)
                data = read_store()
                data["revision"] += 1
                write_json(DATA_PATH, data)
                thumbnail = os.path.join(THUMB_DIR, hashlib.sha256(key.encode()).hexdigest() + ".jpg")
                try:
                    os.unlink(os.path.join(INFO_DIR, hashlib.sha256(key.encode()).hexdigest() + ".json"))
                except FileNotFoundError:
                    pass
                try:
                    os.unlink(thumbnail)
                except FileNotFoundError:
                    pass
                return self.reply(200, {"deleted": key, "bytes": size, "people": data})
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {"error": "invalid_request"})
        except OSError:
            return self.reply(503, {"error": "delete_failed"})

    def do_PUT(self):
        if urlsplit(self.path).path != "/people":
            return self.reply(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {"error": "too_large"})
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {"error": "invalid_json"})
        if not validate(payload):
            return self.reply(400, {"error": "invalid_data"})
        with LOCK:
            current = read_store()
            if payload["revision"] != current["revision"]:
                return self.reply(409, current)
            deleted = deleted_ids()
            updated = {
                "revision": current["revision"] + 1,
                "people": payload["people"],
                "assignments": {key: value for key, value in payload["assignments"].items() if key not in deleted},
            }
            directory = os.path.dirname(DATA_PATH)
            os.makedirs(directory, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix="people-", dir=directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    json.dump(updated, file, ensure_ascii=False, separators=(",", ":"))
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary, DATA_PATH)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            self.reply(200, updated)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8780), Handler).serve_forever()
