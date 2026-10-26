import { Capacitor, registerPlugin } from '@capacitor/core';

type SaveImageOptions = {
  expectedSize: number;
  fileName: string;
  mimeType: string;
  url: string;
};

type SaveImageResult = {
  location: string;
};

type ImageSaverPlugin = {
  saveImage(options: SaveImageOptions): Promise<SaveImageResult>;
};

const ImageSaver = registerPlugin<ImageSaverPlugin>('ImageSaver');

export function isNativeImageSaveAvailable() {
  return Capacitor.isNativePlatform();
}

export function saveImageToPhone(options: SaveImageOptions) {
  return ImageSaver.saveImage(options);
}
