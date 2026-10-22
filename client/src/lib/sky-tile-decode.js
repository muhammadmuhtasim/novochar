// Decode a sky-tile PNG into an ImageBitmap whose rows are already flipped.
//
// The server encodes both bases and HEALPix patches north-up in row 0, and the
// client geometry samples v=1 at north. `UNPACK_FLIP_Y_WEBGL` is ignored for
// ImageBitmap uploads, so the flip must happen while decoding; otherwise the
// whole sky is vertically mirrored. Three.js therefore uploads these bitmaps
// with `texture.flipY = false` (see makeTexture in sky3d-engine.js).

async function flipBitmap(bitmap) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.translate(0, bitmap.height);
    context.scale(1, -1);
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return canvas.transferToImageBitmap();
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.translate(0, bitmap.height);
    context.scale(1, -1);
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return createImageBitmap(canvas);
  }
  return bitmap;
}

/** Decode a PNG blob into a north-up ImageBitmap, ready for a v=1 north UV. */
export async function decodeSkyTile(blob) {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap is unavailable in this browser');
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: 'flipY' });
  } catch {
    // Older engines do not support imageOrientation. Flip explicitly so the
    // geography never depends on the uploader's UNPACK_FLIP_Y behaviour.
    return flipBitmap(await createImageBitmap(blob));
  }
}
