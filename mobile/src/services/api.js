import axios from 'axios/dist/browser/axios.cjs';
import { BACKEND_URL } from '../config/constants';

const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 15000,
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export default api;
