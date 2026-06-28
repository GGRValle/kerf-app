import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.KERF_NATIVE_SERVER_URL ?? 'https://kerf-v17-internal.fly.dev';

const config: CapacitorConfig = {
  appId: process.env.KERF_NATIVE_APP_ID ?? 'com.ggrvalle.kerf.righthand',
  appName: 'Right Hand',
  webDir: 'native-shell',
  server: {
    url: serverUrl,
    cleartext: false
  },
  ios: {
    contentInset: 'automatic',
    scheme: 'RightHand'
  }
};

export default config;
