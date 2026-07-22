/** Client-side image intake for device photos: resized/compressed to a `data:` URL rather than
 *  uploaded to a blob store — there isn't one (the API is a flat JSON file), and a device photo
 *  is small enough, once downscaled, to just live inline in `imageUrl` like a pasted URL would.
 *  Capping dimensions and re-encoding as JPEG keeps a phone photo (often several MB) down to a
 *  few dozen KB before it ever hits the JSON db or the request body. */

const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.82;

export class ImageTooLargeError extends Error {}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/** Downscales `file` to fit within MAX_DIMENSION on its longest side and re-encodes as JPEG,
 *  returning a compact `data:image/jpeg;base64,...` URL ready to store directly in `imageUrl`. */
export async function fileToCompressedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new ImageTooLargeError('Файл не является изображением');

  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
