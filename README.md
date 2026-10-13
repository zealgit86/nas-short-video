# NAS Short Video

把 NAS 里的视频变成可以上下滑动的私人短视频库。

A self-hosted, mobile-friendly video feed for your NAS, with people, favorites, thumbnails and uploads.

基于 [will-moss/erin](https://github.com/will-moss/erin) 修改，保留上游 MIT 许可证和版权声明。这是社区增强版，与 TikTok、抖音无隶属关系。

## 功能

- 随机刷视频，单击暂停、双击收藏。
- 长按 2 倍速，以及 1 / 1.5 / 2 倍速按钮。
- 人物分组、创建人物、编辑头像、移出和转移视频。
- 未设置头像时，自动用该人物名下的视频缩略图作为头像。
- 人物及收藏缩略图；日期、时长和文件大小。
- 从缩略图进入播放后保留原列表位置，支持上下滑动，返回时定位当前视频。
- 手机上传视频到指定人物，可选择或新建保存文件夹，不覆盖同名文件。
- 网页刷新索引并显示新增数量。
- 经确认后永久删除原视频。
- 密码保护、Docker Compose 部署；缩略图和视频信息缓存。

## 快速开始

需要 Docker 和 Docker Compose。首次构建需要联网下载 Node、Caddy、Python 和 FFmpeg 相关依赖。

```sh
git clone https://github.com/zealgit86/nas-short-video.git
cd nas-short-video
cp .env.example .env
mkdir -p media/library media/mobile data
docker compose build
# 此命令会交互式询问密码，不要将密码写入命令行。
docker run --rm -it --entrypoint caddy nas-short-video:local hash-password
```

将生成的 bcrypt hash 放入 `.env`，保留单引号：

```dotenv
AUTH_SECRET='粘贴生成的完整 bcrypt hash'
```

修改 `.env` 中的 `LIBRARY_PATH` 和 `UPLOAD_PATH` 为自己的视频目录。需要手机访问时，把 `BIND_ADDRESS` 设为 NAS 的局域网 IP，并将 `PUBLIC_URL` 改为 `http://你的NAS局域网IP:8765`。

```sh
docker compose up -d
```

打开 `PUBLIC_URL`，输入刚才设定的密码。首次进入点击左上角“视频目录”→“刷新索引”。视频较多时扫描会在后台继续，可查看进度。

## 文件与权限

容器内使用两个逻辑目录：`library`（视频库）和 `mobile`（上传目录）。宿主机目录可以任意选择，无须与逻辑名称一致。人物归属使用视频相对路径，部署后不要随意改逻辑挂载名称。

- `data/`：人物资料、索引、缩略图和信息缓存，需要持久化并备份。
- 收藏保存在当前浏览器；人物资料跨设备共享，收藏不会自动跨设备同步。
- 视频目录默认可写，以支持上传和删除。若只需观看，可将 Compose 对应挂载加上 `:ro`；这时上传、创建文件夹和删除会失败。
- 删除按钮永久删除 NAS 原文件，确认前请核对；项目不提供回收站。
- 默认扫描 MP4 / MOV / WEBM / OGG；播放是否可用取决于浏览器支持的编码。项目不会自动转码不兼容的视频。
- 上传最大 8 GiB/文件，关闭页面不支持断点恢复。同名文件会使用新名称，避免覆盖。
- 自动头像使用已有缩略图接口，不会改写手动头像。人物没有视频时显示名字首字。

## 安全与部署边界

这是面向家庭局域网或 VPN 的个人视频库。默认绑定本机地址，尚未作为公网多用户服务审计。

认证沿用 Erin：认证后的媒体/API URL 携带访问令牌。不要分享这些 URL、日志、`.env` 或人物数据；令牌虽然使用 bcrypt 字符串表示，仍应视为访问凭据。HTTP 适用于可信局域网；远程访问建议 VPN 或配置 HTTPS 反向代理。只导入自己信任的元数据，元数据字幕可包含 HTML。

详见 [部署说明](docs/DEPLOYMENT.md) 与 [安全说明](SECURITY.md)。

## 开发

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install --frozen-lockfile
pnpm test -- --watch=false --runInBand
pnpm build
python3 -m py_compile people-api.py
```

前端为 React，静态文件和认证由 Caddy 提供，Python 服务负责索引、人物、上传、删除与缩略图。生产构建使用多阶段 Dockerfile，不依赖维护者的 NAS 镜像或私有路径。

## 致谢与许可证

MIT。感谢 [Erin](https://github.com/will-moss/erin) 作者 Will Moss，以及 React、Caddy 和 FFmpeg 项目。上游声明完整保留于 [LICENSE](LICENSE)。此仓库只包含源码和通用部署示例，不包含任何个人视频、头像、人物资料、访问密码或私人部署脚本。
