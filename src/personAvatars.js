import { videoId } from "./peopleStore";

// Derive display-only covers; saved avatars and person records stay unchanged.
export const withVideoAvatars = (people, assignments, videos, publicUrl) => {
  const covers = new Map();
  for (const video of videos) {
    const personId = assignments[videoId(video)];
    if (!personId || covers.has(personId) || video.type === "image") continue;
    const hash = new URL(video.url, publicUrl).searchParams.get("hash") || "";
    covers.set(personId, `${publicUrl}/api/thumb?video=${encodeURIComponent(videoId(video))}&hash=${encodeURIComponent(hash)}`);
  }
  return people.map((person) => person.avatar ? person : {
    ...person, defaultAvatarUrl: covers.get(person.id) || "",
  });
};
