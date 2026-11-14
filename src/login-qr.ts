/** Render the SDK's existing approval payload with a complete quiet zone and
 * whole-pixel cells. No challenge, signer or authentication state is changed. */
export async function observeLoginQr(): Promise<() => void> {
  const { paintLoginQr } = await import('./login-qr-encoder.js')
  const drawings = new Map<HTMLCanvasElement, { payload: string; cells: number; parent: HTMLElement }>()
  let active = true
  let frame: number | undefined

  const fit = (canvas: HTMLCanvasElement, cells: number, parent: HTMLElement) => {
    if (!active || !canvas.isConnected) return
    const width = Math.min(360, parent.clientWidth)
    const scale = Math.max(1, Math.floor(width / cells))
    canvas.style.width = `${cells * scale}px`
    canvas.style.height = 'auto'
    canvas.style.maxWidth = '100%'
  }
  const resizing = new ResizeObserver(() => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      for (const [canvas, drawing] of drawings) fit(canvas, drawing.cells, drawing.parent)
    })
  })
  const render = () => {
    if (!active) return
    for (const [canvas, drawing] of drawings) {
      if (!canvas.isConnected) { resizing.unobserve(drawing.parent); drawings.delete(canvas) }
    }
    for (const [id, source, level, label] of [
      ['signet-login-qr', 'signet-login-open-signet', 'H', 'My Signet sign-in QR code'],
      ['signet-login-nc-qr', 'signet-login-nc-uri', 'L', 'NostrConnect pairing QR code'],
    ] as const) {
      const canvas = document.getElementById(id)
      const payloadNode = document.getElementById(source)
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.parentElement) continue
      const payload = payloadNode instanceof HTMLAnchorElement ? payloadNode.getAttribute('href')
        : payloadNode instanceof HTMLTextAreaElement ? payloadNode.value : null
      if (!payload || drawings.get(canvas)?.payload === payload) continue
      const cells = paintLoginQr(canvas, payload, level)
      if (cells === null) continue
      // The SDK's second padding layer otherwise compresses a dense QR below
      // two screen pixels per cell at the supported 320px viewport.
      canvas.parentElement.style.padding = '0'
      canvas.setAttribute('aria-label', label)
      drawings.set(canvas, { payload, cells, parent: canvas.parentElement })
      resizing.observe(canvas.parentElement)
      fit(canvas, cells, canvas.parentElement)
    }
  }
  const changes = new MutationObserver(render)
  changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
  render()
  return () => {
    active = false; changes.disconnect(); resizing.disconnect(); drawings.clear()
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
