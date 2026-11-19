export class RafScheduler {
  private handle: number | null = null;
  private dirty = false;

  constructor(private readonly renderFn: () => void) {}

  schedule(): void {
    this.dirty = true;
    if (this.handle !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      this.dirty = false;
      this.renderFn();
      return;
    }
    this.handle = requestAnimationFrame(() => {
      this.handle = null;
      if (this.dirty) {
        this.dirty = false;
        this.renderFn();
      }
    });
  }

  cancel(): void {
    if (this.handle !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.handle);
      this.handle = null;
    }
    this.dirty = false;
  }
}
