/**
 * Reads the EXIF orientation (1..8) from the head of a JPEG, or 0 if the file
 * carries none. Embedded RAW previews are sometimes stored unrotated with no
 * orientation tag, so the caller needs to know whether the browser will
 * rotate the image by itself.
 */
export function readJpegOrientation(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 0
  let pos = 2
  while (pos + 4 <= view.byteLength) {
    const marker = view.getUint16(pos)
    if ((marker & 0xff00) !== 0xff00) return 0
    const size = view.getUint16(pos + 2)
    // APP1 "Exif\0\0"
    if (marker === 0xffe1 && pos + 10 <= view.byteLength && view.getUint32(pos + 4) === 0x45786966) {
      const tiff = pos + 10
      if (tiff + 8 > view.byteLength) return 0
      const little = view.getUint16(tiff) === 0x4949
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > view.byteLength) return 0
      const count = view.getUint16(ifd, little)
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > view.byteLength) return 0
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little)
          return value >= 1 && value <= 8 ? value : 0
        }
      }
      return 0
    }
    // Start of scan: image data follows, no more metadata.
    if (marker === 0xffda) return 0
    pos += 2 + size
  }
  return 0
}
