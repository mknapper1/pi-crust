import type { PiDesktopApi } from '../shared/contracts';

declare global {
  interface Window {
    piDesktop: PiDesktopApi;
  }
}

export {};
