import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config/constants';

let socket;

export function connectSocket(userId) {
  if (!socket) {
    socket = io(BACKEND_URL, { transports: ['websocket'] });
  }

  socket.on('connect', () => {
    if (userId) {
      socket.emit('register-user', { userId });
    }
  });

  if (socket.connected && userId) {
    socket.emit('register-user', { userId });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = undefined;
  }
}

export function getSocket() {
  return socket;
}
