/** Merge pending requests while keeping writes ordered and preserving await semantics. */
export class SaveQueue {
    private pending: { resolve: () => void; reject: (error: unknown) => void }[] = [];
    private running = false;
    private scheduled = false;

    constructor(private readonly write: () => Promise<void>) {}

    request(): Promise<void> {
        const result = new Promise<void>((resolve, reject) => this.pending.push({ resolve, reject }));
        if (!this.running && !this.scheduled) {
            this.scheduled = true;
            void Promise.resolve().then(() => this.flush());
        }
        return result;
    }

    private async flush(): Promise<void> {
        this.scheduled = false;
        this.running = true;
        while (this.pending.length) {
            const batch = this.pending;
            this.pending = [];
            try {
                await this.write();
                for (const waiter of batch) waiter.resolve();
            } catch (error) {
                for (const waiter of batch) waiter.reject(error);
            }
        }
        this.running = false;
    }
}
