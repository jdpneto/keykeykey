import browser from 'webextension-polyfill';
import type { BackgroundMessage } from '../../lib/messages.js';

export async function sendMessage<T>(message: BackgroundMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
