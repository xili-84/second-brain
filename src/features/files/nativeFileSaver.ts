import { Capacitor, registerPlugin } from '@capacitor/core';

type SaveFileOptions = {
  expectedSize: number;
  fileName: string;
  mimeType: string;
  url: string;
};

export type SavedFile = {
  /** A human-readable place, e.g. "Downloads/Second Brain". */
  location: string;
  /** Android's own address for the saved copy; pass it to openSavedFile. */
  uri: string;
};

type FileSaverPlugin = {
  openFile(options: { mimeType: string; uri: string }): Promise<void>;
  saveFile(options: SaveFileOptions): Promise<SavedFile>;
};

const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver');

/** True inside the Android app, where files are saved to Downloads instead of the browser. */
export function isNativeFileSaveAvailable() {
  return Capacitor.isNativePlatform();
}

export function saveFileToPhone(options: SaveFileOptions) {
  return FileSaver.saveFile(options);
}

export function openSavedFile(options: { mimeType: string; uri: string }) {
  return FileSaver.openFile(options);
}
