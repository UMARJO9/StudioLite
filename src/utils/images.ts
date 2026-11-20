// Prepares pictures for a chat message: the browser decodes the file, large ones are scaled
// down, and a small preview is made for the chat history.

export interface PreparedImage {
  /** For the list key and the remove button. */
  id: string;
  name: string;
  mediaType: string;
  /** Base64 without the `data:...;base64,` prefix. */
  data: string;
  /** Small data URL shown in the composer and kept in the history. */
  preview: string;
}

/** Sent as is when the file already has one of these types and is small enough. */
const PASS_THROUGH_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** Longer sides are scaled down: more pixels cost time and add nothing for the reader. */
export const MAX_IMAGE_SIDE = 1568;
const MAX_PASS_THROUGH_BYTES = 3 * 1024 * 1024;
const PREVIEW_SIDE = 240;

/** Size after scaling so that the longer side is at most `maxSide`, keeping proportions. */
export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function splitDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('файл не является изображением, которое можно показать'));
    image.src = src;
  });
}

function draw(image: HTMLImageElement, maxSide: number, type: string, quality?: number): string {
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('не удалось обработать изображение');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(type, quality);
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);

  const fits =
    Math.max(image.naturalWidth, image.naturalHeight) <= MAX_IMAGE_SIDE &&
    file.size <= MAX_PASS_THROUGH_BYTES &&
    PASS_THROUGH_TYPES.includes(file.type);
  // Screenshots keep their sharp text as PNG unless that makes them too heavy.
  let encoded = fits ? original : draw(image, MAX_IMAGE_SIDE, 'image/png');
  if (!fits && encoded.length > MAX_PASS_THROUGH_BYTES * 1.4) {
    encoded = draw(image, MAX_IMAGE_SIDE, 'image/jpeg', 0.9);
  }
  const parts = splitDataUrl(encoded);
  if (!parts) throw new Error('не удалось обработать изображение');

  return {
    id: crypto.randomUUID(),
    name: file.name || 'изображение',
    mediaType: parts.mediaType,
    data: parts.data,
    preview: draw(image, PREVIEW_SIDE, 'image/jpeg', 0.8),
  };
}

/** Picture files among what was pasted or dropped. */
export function imageFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
