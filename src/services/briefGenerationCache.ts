import { AiProviderAdmissionError } from "./aiProviderAdmissionService";

/** Process-local reuse only; provider admission remains the durable authority. */
export class BriefGenerationCache<Entry extends { expiresAt: number }> {
  private readonly cache = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<Entry>>();
  private readonly admissionDenials = new Map<
    string,
    { error: AiProviderAdmissionError; retryAt: number }
  >();

  constructor(
    private readonly generateEntry: (userId: string) => Promise<Entry>,
  ) {}

  get(userId: string): Entry | undefined {
    return this.cache.get(userId);
  }

  hasInFlight(userId: string): boolean {
    return this.inFlight.has(userId);
  }

  markStale(userId: string): void {
    const entry = this.cache.get(userId);
    if (entry) this.cache.set(userId, { ...entry, expiresAt: 0 });
  }

  private getAdmissionDenial(userId: string): AiProviderAdmissionError | null {
    const denial = this.admissionDenials.get(userId);
    if (!denial) return null;
    if (denial.retryAt > Date.now()) return denial.error;
    this.admissionDenials.delete(userId);
    return null;
  }

  /** A disconnected waiter cannot cancel a generation shared by other requests. */
  generate(userId: string): Promise<Entry> {
    const existing = this.inFlight.get(userId);
    if (existing) return existing;

    const denial = this.getAdmissionDenial(userId);
    if (denial) return Promise.reject(denial);

    const generation = this.generateEntry(userId)
      .then((entry) => {
        this.cache.set(userId, entry);
        this.admissionDenials.delete(userId);
        return entry;
      })
      .catch((error: unknown) => {
        if (error instanceof AiProviderAdmissionError && error.retryAt) {
          const retryAt = Date.parse(error.retryAt);
          if (Number.isFinite(retryAt) && retryAt > Date.now()) {
            this.admissionDenials.set(userId, { error, retryAt });
          }
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight.get(userId) === generation) {
          this.inFlight.delete(userId);
        }
      });
    this.inFlight.set(userId, generation);
    return generation;
  }

  refreshInBackground(
    userId: string,
    onUnexpectedError: (error: unknown) => void,
  ): void {
    if (this.inFlight.has(userId) || this.getAdmissionDenial(userId)) return;
    void this.generate(userId).catch((error: unknown) => {
      if (!(error instanceof AiProviderAdmissionError)) {
        onUnexpectedError(error);
      }
    });
  }
}
