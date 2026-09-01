/**
 * Minimal but structurally valid file headers, shared by the core and worker
 * test projects. Each one carries just enough bytes for signature detection
 * and, for images, for the dimension reader.
 */

/** A PNG whose IHDR declares the given dimensions. */
export function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A GIF89a header with the given logical screen size. */
export function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(14);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

/** A JPEG with a single SOF0 frame header. */
export function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes;
}

/** A RIFF/WEBP container using the extended (VP8X) canvas header. */
export function webpBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RIFF'), 0);
  bytes.set(encoder.encode('WEBP'), 8);
  bytes.set(encoder.encode('VP8X'), 12);
  const writeUint24LE = (offset: number, value: number): void => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };
  writeUint24LE(24, width - 1);
  writeUint24LE(27, height - 1);
  return bytes;
}

/** A PDF header. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n%binary\n');
}

/** A ZIP local file header, which is also what xlsx and docx start with. */
export function zipBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  return bytes;
}

/** An SVG document, which Mallok does not accept. */
export function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
}
