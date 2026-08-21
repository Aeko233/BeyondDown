/// <reference types="vite/client" />

interface Window {
  QRCode?: new (
    element: HTMLElement,
    options: { text: string; width: number; height: number },
  ) => object;
}
