import { encode, isDark } from '@forgesworn/qr'
import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import { encodeLoginQr, type LoginQrLevel } from './login-qr-encoder.js'
import fixtures from './login-qr.fixture.json'

// The fixture holds module matrices from the encoder this one replaced
// (qrcode-generator, byte mode) at the two levels the sign-in dialog uses. That
// encoder picked its mask with a rule that differs from the QR standard's, so
// the comparison pins its mask.
function rows(qr: ReturnType<typeof encodeLoginQr>): string[] {
  const out: string[] = []
  for (let y = 0; y < qr.size; y++) {
    let line = ''
    for (let x = 0; x < qr.size; x++) line += isDark(qr, x, y) ? '1' : '0'
    out.push(line)
  }
  return out
}

function greyscale(qr: ReturnType<typeof encodeLoginQr>, cell = 4, margin = 4) {
  const side = (qr.size + margin * 2) * cell
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / cell) - margin
      const row = Math.floor(y / cell) - margin
      if (col >= 0 && row >= 0 && col < qr.size && row < qr.size && isDark(qr, col, row)) data.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3)
    }
  }
  return { data, width: side, height: side }
}

describe('sign-in QR encoder', () => {
  for (const fixture of fixtures) {
    const level = fixture.level as LoginQrLevel

    it(`matches the previous encoder with the same mask at level ${level}`, () => {
      const qr = encode(fixture.value, { ecc: level, mode: 'byte', mask: fixture.mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 })
      expect(qr.size).toBe(fixture.size)
      expect(rows(qr)).toEqual(fixture.rows)
    })

    it(`keeps the level and reads back the exact payload with jsQR at level ${level}`, () => {
      const qr = encodeLoginQr(fixture.value, level)
      expect(qr.ecc).toBe(level)
      expect(qr.size).toBe(fixture.size)
      const { data, width, height } = greyscale(qr)
      expect(jsQR(data, width, height)?.data).toBe(fixture.value)
    })
  }
})
