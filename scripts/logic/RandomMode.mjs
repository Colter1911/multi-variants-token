export function pickRandomImage(images = []) {
  if (!Array.isArray(images) || images.length === 0) return null;

  // Исключаем из пула рандома изображения, у которых включён автозапуск.
  const randomPool = images.filter((image) => !image?.autoEnable?.enabled);

  // Если после фильтрации пул пуст, fallback: используем default-изображение.
  const source = randomPool.length
    ? randomPool
    : [images.find((image) => image?.isDefault)].filter(Boolean);

  if (!source.length) return null;

  const index = Math.floor(Math.random() * source.length);
  return source[index];
}

export function sortImagesByOrder(images = []) {
  return [...images].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
}
