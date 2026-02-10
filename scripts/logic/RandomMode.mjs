export function pickRandomImage(images = []) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const index = Math.floor(Math.random() * images.length);
  return images[index];
}

export function sortImagesByOrder(images = []) {
  return [...images].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
}
