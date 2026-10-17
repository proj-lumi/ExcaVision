export const MAX_REQUEST_ATTACHMENTS = 5
export const MAX_REQUEST_ATTACHMENT_BYTES = 5 * 1024 * 1024

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
])

export function validateRequestAttachment(file: File) {
  if (!allowedMimeTypes.has(file.type)) return 'Use JPEG, PNG, WebP, HEIC, or HEIF photos only.'
  if (file.size > MAX_REQUEST_ATTACHMENT_BYTES) return 'Each photo must be 5 MB or smaller.'
  return ''
}

export function validateRequestAttachments(files: File[]) {
  if (files.length > MAX_REQUEST_ATTACHMENTS) return 'You can add up to 5 photos. Remove one to add another.'
  return files.map(validateRequestAttachment).find(Boolean) ?? ''
}

export async function hasValidRequestAttachmentSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (file.type === 'image/png') return bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
  if (file.type === 'image/webp') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  if (file.type === 'image/heic' || file.type === 'image/heif') return new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
  return false
}
