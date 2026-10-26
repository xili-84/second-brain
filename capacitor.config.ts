import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.okdaily.brain',
  appName: 'Second Brain',
  loggingBehavior: 'none',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge WebView; the app pads itself with the injected --safe-area-inset-* values.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      // Status and navigation bar icons follow the system light/dark setting, like the app.
      style: 'DEFAULT',
    },
  },
};

export default config;
