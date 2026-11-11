import { describe, expect, it } from 'vitest'
import { readJpegOrientation } from '../src/main/jpegOrientation'

/** Builds the head of a JPEG with an EXIF block holding one orientation entry. */
function jpegWithOrientation(value: number, littleEndian: boolean): Uint8Array {
  const tiff = new DataView(new ArrayBuffer(26))
  tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d)
  tiff.setUint16(2, 42, littleEndian)
  tiff.setUint32(4, 8, littleEndian)
  tiff.setUint16(8, 1, littleEndian) // one entry
  tiff.setUint16(10, 0x0112, littleEndian)
  tiff.setUint16(12, 3, littleEndian) // SHORT
  tiff.setUint32(14, 1, littleEndian)
  tiff.setUint16(18, value, littleEndian)
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...new Uint8Array(tiff.buffer)]
  const size = exif.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...exif, 0xff, 0xda, 0, 2])
}

describe('readJpegOrientation', () => {
  it('reads the tag in either byte order', () => {
    expect(readJpegOrientation(jpegWithOrientation(6, true))).toBe(6)
    expect(readJpegOrientation(jpegWithOrientation(8, false))).toBe(8)
  })
  it('returns 0 when there is no EXIF or the data is not a JPEG', () => {
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(0)
    expect(readJpegOrientation(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBe(0)
    expect(readJpegOrientation(new Uint8Array(0))).toBe(0)
  })
  it('does not read past a truncated file', () => {
    expect(readJpegOrientation(jpegWithOrientation(6, true).subarray(0, 20))).toBe(0)
  })
})
