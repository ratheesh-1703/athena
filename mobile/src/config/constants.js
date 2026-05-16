import Constants from 'expo-constants';
import { Platform } from 'react-native';

const configuredUrl =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  Constants.expoConfig?.extra?.backendUrl ||
  'http://10.0.2.2:5000';

const isProdBuild = !__DEV__;

if (isProdBuild && (!configuredUrl || configuredUrl.includes('10.0.2.2') || configuredUrl.includes('localhost'))) {
  throw new Error(
    'Invalid production backend URL. Set EXPO_PUBLIC_BACKEND_URL to your public HTTPS API base URL.'
  );
}

const webSafeUrl = configuredUrl.replace('10.0.2.2', 'localhost');

export const BACKEND_URL = Platform.OS === 'web' ? webSafeUrl : configuredUrl;
