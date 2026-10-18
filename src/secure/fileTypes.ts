/**
 * File-type policy for received files: detect the real type from magic bytes,
 * refuse executables and installers, and refuse files whose name claims a
 * different type than their content. Received files are never auto-opened.
 */

export type DetectedKind =
  | 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'pdf' | 'zip' | 'mp3' | 'mp4' | 'ogg' | 'wav'
  | 'text' | 'elf' | 'pe' | 'dex' | 'script' | 'unknown';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const CHUNK_SIZE = 16 * 1024;

const BLOCKED_KINDS: ReadonlySet<DetectedKind> = new Set(['elf', 'pe', 'dex', 'script']);

const BLOCKED_EXTENSIONS = new Set([
  'apk', 'apks', 'xapk', 'aab', 'dex', 'jar', 'exe', 'dll', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1',
  'vbs', 'js', 'mjs', 'sh', 'bash', 'elf', 'so', 'bin', 'html', 'htm', 'svg', 'hta', 'lnk', 'jse', 'wsf',
]);

/** Which detected kinds each allowed extension may contain. */
const EXTENSION_KINDS: Record<string, DetectedKind[]> = {
  jpg: ['jpeg'], jpeg: ['jpeg'], png: ['png'], gif: ['gif'], webp: ['webp'], heic: ['heic'], heif: ['heic'],
  pdf: ['pdf'],
  zip: ['zip'], docx: ['zip'], xlsx: ['zip'], pptx: ['zip'], odt: ['zip'], ods: ['zip'], epub: ['zip'],
  mp3: ['mp3'], m4a: ['mp4'], mp4: ['mp4'], mov: ['mp4'], '3gp': ['mp4'], ogg: ['ogg'], opus: ['ogg'], wav: ['wav'],
  txt: ['text'], csv: ['text'], md: ['text'], json: ['text'], log: ['text'],
};

const MIME: Record<DetectedKind, string> = {
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', ogg: 'audio/ogg',
  wav: 'audio/wav', text: 'text/plain', elf: 'application/octet-stream', pe: 'application/octet-stream',
  dex: 'application/octet-stream', script: 'text/plain', unknown: 'application/octet-stream',
};

function startsWith(head: Uint8Array, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

function ascii(head: Uint8Array, offset: number, text: string): boolean {
  return startsWith(head, [...text].map((c) => c.charCodeAt(0)), offset);
}

function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return true;
  let printable = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0x80) printable++;
  }
  return printable / head.length > 0.95;
}

export function detectKind(head: Uint8Array): DetectedKind {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'webp';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')) return 'wav';
  if (ascii(head, 4, 'ftyp')) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    return /^(heic|heix|hevc|mif1|msf1)$/.test(brand) ? 'heic' : 'mp4';
  }
  if (ascii(head, 0, '%PDF-')) return 'pdf';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
  if (ascii(head, 0, 'ID3') || startsWith(head, [0xff, 0xfb]) || startsWith(head, [0xff, 0xf3]) || startsWith(head, [0xff, 0xf2])) return 'mp3';
  if (ascii(head, 0, 'OggS')) return 'ogg';
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';
  if (ascii(head, 0, 'MZ')) return 'pe';
  if (ascii(head, 0, 'dex\n')) return 'dex';
  if (ascii(head, 0, '#!')) return 'script';
  if (looksLikeText(head)) return 'text';
  return 'unknown';
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Strip paths, control characters and reserved names; keep a readable name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!clean) clean = 'received-file';
  if (clean.length > 120) {
    const ext = extensionOf(clean);
    clean = clean.slice(0, 110) + (ext ? '.' + ext.slice(0, 8) : '');
  }
  return clean;
}

export interface PolicyResult {
  ok: boolean;
  reason?: string;
}

/** Check an incoming offer before the user is even asked. */
export function checkOfferPolicy(name: string, size: number, maxBytes = MAX_FILE_BYTES): PolicyResult {
  const ext = extensionOf(name);
  if (!Number.isFinite(size) || size < 0) return { ok: false, reason: 'invalid file size' };
  if (size > maxBytes) return { ok: false, reason: `file is larger than the ${Math.round(maxBytes / 1048576)} MB limit` };
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, reason: `.${ext} files can run code and are blocked` };
  if (!EXTENSION_KINDS[ext]) return { ok: false, reason: ext ? `.${ext} files are not on the allowed list` : 'files without an extension are not allowed' };
  return { ok: true };
}

export interface ContentVerdict extends PolicyResult {
  kind: DetectedKind;
  mime: string;
}

/** Check the received bytes: real type must be allowed and agree with the name. */
export function checkContentPolicy(name: string, head: Uint8Array): ContentVerdict {
  const kind = detectKind(head);
  const mime = MIME[kind];
  if (BLOCKED_KINDS.has(kind)) return { ok: false, kind, mime, reason: `content is an executable or script (${kind}); quarantined file deleted` };
  const allowed = EXTENSION_KINDS[extensionOf(name)] ?? [];
  if (!allowed.includes(kind)) {
    return { ok: false, kind, mime, reason: `name says .${extensionOf(name)} but the content is ${kind}` };
  }
  return { ok: true, kind, mime };
}

export function mimeForName(name: string): string {
  const kinds = EXTENSION_KINDS[extensionOf(name)];
  return kinds ? MIME[kinds[0]] : 'application/octet-stream';
}
