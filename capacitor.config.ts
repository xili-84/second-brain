import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.okdaily.brain',
  appName: 'Second Brain',
  loggingBehavior: 'none',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
