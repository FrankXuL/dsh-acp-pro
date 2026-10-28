/** A per-binding FIFO lock. Cancellation is intentionally handled outside this queue. */
export class SessionCoordinator {
  private readonly tails = new Map<string, Promise<void>>()

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const tail = previous.catch(() => {}).then(() => current)
    this.tails.set(key, tail)
    await previous.catch(() => {})
    let released = false
    return () => {
      if (released)
        return
      released = true
      releaseCurrent()
      if (this.tails.get(key) === tail)
        void tail.then(() => {
          if (this.tails.get(key) === tail)
            this.tails.delete(key)
        })
    }
  }

  async run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key)
    try {
      return await action()
    }
    finally {
      release()
    }
  }
}
