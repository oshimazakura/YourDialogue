export function imageSize(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let position = 2;
    while (position + 4 <= bytes.length) {
      if (bytes[position++] !== 0xff) break;
      while (bytes[position] === 0xff) position++;
      const marker = bytes[position++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (position + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(position);
      if (length < 2 || position + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 8
      ) {
        return {
          height: bytes.readUInt16BE(position + 3),
          width: bytes.readUInt16BE(position + 5),
        };
      }
      position += length;
    }
  }
  throw new Error('PNGまたはJPEG画像を選択してください。');
}
export function checkImageSize(bytes: Buffer) {
  const size = imageSize(bytes);
  if (
    !size.width ||
    !size.height ||
    size.width > 8192 ||
    size.height > 8192 ||
    size.width * size.height > 24_000_000
  )
    throw new Error('画像は8192px・2400万画素以内にしてください。');
  return size;
}
