import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cupidplayer.app',
  appName: 'cupid-player',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;