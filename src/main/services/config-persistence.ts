export type ConfigStartupState = 'pending' | 'loaded' | 'missing' | 'recovered'

/** Controls automatic window-state writes separately from explicit config writes. */
export class ConfigPersistencePolicy {
  private current: ConfigStartupState = 'pending'

  state(): ConfigStartupState { return this.current }
  allowWindowAutoSave(): boolean { return this.current === 'loaded' || this.current === 'missing' }
  markLoaded(): void { this.current = 'loaded' }
  markMissing(): void { this.current = 'missing' }
  markRecovered(): void { this.current = 'recovered' }
  markExplicitWriteSucceeded(): void { this.current = 'loaded' }
}
