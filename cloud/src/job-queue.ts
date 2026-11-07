// The Cloud's queue of jobs waiting to start (decision 0076): which job starts next when a place frees. A job whose
// provider is full is skipped (Cloud-3). Between teams the start is fair: the team with the fewest jobs running goes
// first, and among equals the team that started a job longest ago, so one team's long queue (a looping agent, a 250-job
// video) never holds another team's work back. Within a team, jobs start in the order they were queued.

export interface QueuedJob {
  id: string
  provider: string
  team: string
}

export class JobQueue {
  private readonly order: QueuedJob[] = []
  private readonly runningByProvider = new Map<string, number>()
  private readonly runningByTeam = new Map<string, number>()
  /** The sequence number of each team's last start (round robin among teams that run as many jobs). */
  private readonly lastStart = new Map<string, number>()
  private starts = 0

  get size(): number {
    return this.order.length
  }

  push(job: QueuedJob): void {
    this.order.push(job)
  }

  remove(id: string): void {
    const i = this.order.findIndex((j) => j.id === id)
    if (i >= 0) this.order.splice(i, 1)
  }

  clear(): void {
    this.order.length = 0
  }

  /** The job to start now, taken out of the queue (the caller then calls `started`); undefined when none can start. */
  take(capOf: (provider: string) => number): QueuedJob | undefined {
    let best = -1
    let bestKey: [number, number] = [Infinity, Infinity]
    const seen = new Set<string>()
    for (const [i, j] of this.order.entries()) {
      // only a team's oldest startable job competes
      if (seen.has(j.team) || (this.runningByProvider.get(j.provider) ?? 0) >= capOf(j.provider)) continue
      seen.add(j.team)
      const key: [number, number] = [this.runningByTeam.get(j.team) ?? 0, this.lastStart.get(j.team) ?? -1]
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = i
        bestKey = key
      }
    }
    return best < 0 ? undefined : this.order.splice(best, 1)[0]
  }

  started(job: QueuedJob): void {
    this.runningByProvider.set(job.provider, (this.runningByProvider.get(job.provider) ?? 0) + 1)
    this.runningByTeam.set(job.team, (this.runningByTeam.get(job.team) ?? 0) + 1)
    this.lastStart.set(job.team, this.starts++)
  }

  ended(job: QueuedJob): void {
    for (const [counts, key] of [[this.runningByProvider, job.provider], [this.runningByTeam, job.team]] as const) {
      const left = (counts.get(key) ?? 1) - 1
      if (left > 0) counts.set(key, left)
      else counts.delete(key)
    }
  }
}
