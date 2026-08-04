export type BrowserGuest = HTMLElement & {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getTitle: () => string;
  getURL: () => string;
  getUserAgent: () => string;
  goBack: () => void;
  goForward: () => void;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
  send: (channel: string, ...args: unknown[]) => void;
  setUserAgent: (userAgent: string) => void;
  stop: () => void;
};

export type BrowserWebviewEntry = {
  wrapper: HTMLDivElement;
  webview: BrowserGuest;
};

const BROWSER_PARTITION = 'persist:frakio-browser';
const PARKING_ID = 'frakio-browser-parking';

class BrowserWebviewPool {
  private entry: BrowserWebviewEntry | null = null;
  private parking: HTMLDivElement | null = null;

  acquire(): BrowserWebviewEntry {
    if (this.entry) return this.entry;
    const wrapper = document.createElement('div');
    wrapper.dataset.frakioBrowserWrapper = 'true';
    wrapper.style.cssText = 'position:relative;width:100%;height:100%;display:flex;background:#fff;';
    const webview = document.createElement('webview') as BrowserGuest;
    webview.dataset.frakioBrowserWebview = 'true';
    webview.setAttribute('partition', BROWSER_PARTITION);
    webview.setAttribute('src', 'about:blank');
    webview.setAttribute('style', 'flex:1;width:100%;height:100%;min-width:0;min-height:0;border:0;');
    wrapper.appendChild(webview);
    this.entry = { wrapper, webview };
    return this.entry;
  }

  park(wrapper = this.entry?.wrapper): void {
    if (!wrapper) return;
    this.ensureParking().appendChild(wrapper);
  }

  destroy(): void {
    this.entry?.wrapper.remove();
    this.entry = null;
    this.parking?.remove();
    this.parking = null;
  }

  private ensureParking(): HTMLDivElement {
    if (this.parking?.isConnected) return this.parking;
    const existing = document.getElementById(PARKING_ID);
    if (existing instanceof HTMLDivElement) {
      this.parking = existing;
      return existing;
    }
    const parking = document.createElement('div');
    parking.id = PARKING_ID;
    parking.setAttribute('aria-hidden', 'true');
    parking.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;overflow:hidden;';
    document.body.appendChild(parking);
    this.parking = parking;
    return parking;
  }
}

export const browserWebviewPool = new BrowserWebviewPool();

export function normalizeBrowserUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) return 'http://localhost:3000/';
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http 或 https 网页地址。');
  return url.toString();
}
