import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';

type UpdateListener = (isAvailable: boolean) => void;

const listeners = new Set<UpdateListener>();
let initialized = false;
let isUpdateAvailable = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

function notifyListeners() {
  listeners.forEach((listener) => listener(isUpdateAvailable));
}

export function initializePwaUpdates() {
  if (initialized || Capacitor.isNativePlatform()) {
    return;
  }

  initialized = true;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      isUpdateAvailable = true;
      notifyListeners();
    },
  });
}

export function subscribeToPwaUpdates(listener: UpdateListener) {
  listeners.add(listener);
  listener(isUpdateAvailable);

  return () => {
    listeners.delete(listener);
  };
}

export async function applyPwaUpdate() {
  if (updateServiceWorker) {
    await updateServiceWorker(true);
  }
}
