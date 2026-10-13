import { withVideoAvatars } from "./personAvatars";
const video = (filename, type = "video") => ({ playlist: "library", filename, type,
  url: `http://nas/library/${filename}?hash=secret` });
const people = [{ id: "a", name: "自动", avatar: "" },
  { id: "b", name: "手动", avatar: "data:image/jpeg;base64,saved" },
  { id: "c", name: "空人物", avatar: "" }];
test("assigned video covers preserve custom avatars, stored records and follow transfers", () => {
  const videos = [video("photo.jpg", "image"), video("one.mp4"), video("two.mp4")];
  const assignments = { "library/photo.jpg": "a", "library/one.mp4": "a", "library/two.mp4": "b" };
  const result = withVideoAvatars(people, assignments, videos, "http://nas");
  expect(result[0].defaultAvatarUrl).toBe("http://nas/api/thumb?video=library%2Fone.mp4&hash=secret");
  expect(result[1]).toBe(people[1]);
  expect(result[2].defaultAvatarUrl).toBe("");
  expect(people[0]).not.toHaveProperty("defaultAvatarUrl");
  const transferred = withVideoAvatars(people, { "library/one.mp4": "c" }, videos, "http://nas");
  expect(transferred[0].defaultAvatarUrl).toBe("");
  expect(transferred[2].defaultAvatarUrl).toContain("one.mp4");
});
