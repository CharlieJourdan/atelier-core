/// <reference types="vite/client" />
import type { AtelierBridge } from '../shared/api'

declare global {
  interface Window {
    atelier: AtelierBridge
  }
}

export {}
