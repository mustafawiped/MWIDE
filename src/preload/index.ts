import { contextBridge } from 'electron'
import type { DesktopBridge } from '../shared/contracts'

const desktopBridge: DesktopBridge = Object.freeze({
  platform: process.platform,
})

contextBridge.exposeInMainWorld('mwide', desktopBridge)
