// ZIP with stored entries lets video and JPEG data remain compressed in their original formats.
const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export async function writeZip(files: Map<string, Blob>) {
  const entries: BlobPart[] = [], directory: BlobPart[] = [];
  let offset = 0, directorySize = 0;
  if (files.size > 65535) throw new Error('回放包含太多文件。');
  for (const [name, file] of files) {
    const path = utf8.encode(name);
    const size = file.size, crc = crc32(new Uint8Array(await file.arrayBuffer()));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 2048, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, path.length, true);
    entries.push(local.buffer as ArrayBuffer, path, file);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 2048, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, path.length, true);
    central.setUint32(42, offset, true);
    directory.push(central.buffer as ArrayBuffer, path);
    offset += 30 + path.length + size;
    directorySize += 46 + path.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.size, true);
  end.setUint16(10, files.size, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end.buffer as ArrayBuffer], { type: 'application/zip' });
}

export async function readZip(file: Blob) {
  const files = new Map<string, Blob>();
  const end = new DataView(await file.slice(-22).arrayBuffer());
  const invalid = () => new Error('回放压缩包损坏或格式不受支持。');
  if (end.byteLength !== 22 || end.getUint32(0, true) !== 0x06054b50) throw invalid();
  const directoryOffset = end.getUint32(16, true);
  const size = end.getUint32(12, true);
  if (directoryOffset + size + 22 !== file.size) throw invalid();
  const bytes = await file.arrayBuffer();
  const directory = new DataView(bytes, directoryOffset, size);
  const count = end.getUint16(10, true);
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > size || directory.getUint32(at, true) !== 0x02014b50 ||
      directory.getUint16(at + 10, true) !== 0) throw invalid();
    const length = directory.getUint16(at + 28, true);
    const endName = at + 46 + length;
    if (endName > size) throw invalid();
    const name = decoder.decode(new Uint8Array(bytes, directoryOffset + at + 46, length));
    const localOffset = directory.getUint32(at + 42, true);
    const entrySize = directory.getUint32(at + 24, true);
    if (localOffset + 30 > directoryOffset || files.has(name)) throw invalid();
    const local = new DataView(bytes, localOffset, 30);
    if (local.getUint32(0, true) !== 0x04034b50) throw invalid();
    const start = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    if (start + entrySize > directoryOffset ||
      crc32(new Uint8Array(bytes, start, entrySize)) !== directory.getUint32(at + 16, true)) throw invalid();
    files.set(name, file.slice(start, start + entrySize));
    at = endName + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
  }
  if (at !== size) throw invalid();
  return files;
}
