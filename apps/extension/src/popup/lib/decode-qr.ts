/**
 * Decode a QR code from a screenshot data URL using jsQR.
 *
 * The popup uses this with `browser.tabs.captureVisibleTab` to read the
 * 2FA QR code shown by a website during enrolment, so the user doesn't
 * have to type a Base32 secret by hand.
 *
 * Returns the decoded payload (typically an `otpauth://` URI), or `null`
 * if no QR code was found in the image.
 */

import jsQR from 'jsqr';

export async function decodeQrFromDataUrl(dataUrl: string): Promise<string | null> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data ?? null;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load captured image'));
    img.src = dataUrl;
  });
}
