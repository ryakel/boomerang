// Downscale image attachments to keep payloads small. iPhone photos are often
// 2-5 MB raw, which bloats to 2.7-6.7 MB as base64 — enough to (a) trip the
// server's 2 MB JSON body limit, (b) blow past localStorage's ~5 MB quota on
// iOS Safari, and (c) OOM the tab during JSON.stringify. Re-encoding through
// a canvas at a sane max dimension brings typical phone photos to 200-400 KB.

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to decode image'))
    }
    img.src = url
  })
}

export async function compressImage(file) {
  const { img, url } = await loadImage(file)
  try {
    let { width, height } = img
    if (!width || !height) throw new Error('Image has no dimensions')
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    const base64 = dataUrl.split(',')[1] || ''
    if (!base64) throw new Error('Canvas encoding produced no data')
    return {
      name: file.name.replace(/\.[^/.]+$/, '') + '.jpg',
      type: 'image/jpeg',
      size: Math.ceil(base64.length * 0.75),
      data: base64,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'))
        return
      }
      const [, base64] = result.split(',')
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        data: base64 || '',
      })
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// Process one file into the { name, type, size, data } shape used by
// task attachments. Images go through the canvas compressor; anything
// else is passed through as base64.
export async function processAttachment(file) {
  if (file.type && file.type.startsWith('image/')) {
    try {
      return await compressImage(file)
    } catch {
      // Fall through — e.g. HEIC the browser can't decode. Pass raw bytes
      // along so the user still gets an attachment rather than a crash.
    }
  }
  return readFileAsBase64(file)
}
