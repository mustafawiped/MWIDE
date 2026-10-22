/** The renderer receives no general-purpose filesystem, process, or IPC access. */
export interface DesktopBridge {
  readonly platform: string
}
