export const videoId = (video) => `${video.playlist}/${video.filename}`;

export const peopleEndpoint = (hash) =>
  `${window.PUBLIC_URL}/api/people?hash=${encodeURIComponent(hash)}`;

export const createPersonId = () =>
  (window.crypto?.randomUUID?.() || `person-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .toLowerCase();

export const readAvatarFile = (file) =>
  new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("请选择图片"));
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const context = canvas.getContext("2d");
      const side = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2,
        side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      const result = canvas.toDataURL("image/jpeg", 0.78);
      if (result.length > 220000) return reject(new Error("头像文件过大"));
      resolve(result);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片无法读取"));
    };
    image.src = url;
  });
