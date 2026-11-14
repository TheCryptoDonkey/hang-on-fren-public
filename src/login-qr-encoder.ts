import { encode, isDark, type QrCode } from '@forgesworn/qr'

export type LoginQrLevel = 'L' | 'M' | 'Q' | 'H'

/** Byte mode at the requested error-correction level, smallest version that fits. */
export function encodeLoginQr(payload: string, level: LoginQrLevel): QrCode {
  return encode(payload, { ecc: level, mode: 'byte' })
}

/** Paint a code onto a canvas: whole-pixel cells with a four-cell quiet zone. Returns the cell count a side. */
export function paintLoginQr(canvas: HTMLCanvasElement, payload: string, level: LoginQrLevel): number | null {
  const qr = encodeLoginQr(payload, level)
  const context = canvas.getContext('2d')
  if (!context) return null
  const border = 4, scale = 4, cells = qr.size + 2 * border
  canvas.width = canvas.height = cells * scale
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#0a0418'
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (isDark(qr, x, y)) context.fillRect((x + border) * scale, (y + border) * scale, scale, scale)
  }
  return cells
}
