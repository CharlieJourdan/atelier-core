// At most one call every `everyMs` while events stream in; the last change always lands (trailing call).
export class Throttle {
  private last = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private readonly fn: () => void,
    private readonly everyMs: number
  ) {}

  call(): void {
    if (this.stopped) return
    const wait = this.everyMs - (Date.now() - this.last)
    if (wait <= 0) {
      this.last = Date.now()
      this.fn()
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.last = Date.now()
        if (!this.stopped) this.fn()
      }, wait)
      this.timer.unref?.()
    }
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
