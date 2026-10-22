import type { DesktopBridge } from '../../shared/contracts'

declare global {
  interface Window {
    readonly mwide: DesktopBridge
  }
}

export {}
