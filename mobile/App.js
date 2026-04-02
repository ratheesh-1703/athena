import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Vibration,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Camera, CameraType, FlashMode, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import api, { setAuthToken } from './src/services/api';
import useShakeDetection from './src/hooks/useShakeDetection';
import ProtectionModeOverlay from './src/components/ProtectionModeOverlay';
import { connectSocket, disconnectSocket } from './src/services/socket';

let NativeMapView;
let NativeMarker;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  NativeMapView = maps.default;
  NativeMarker = maps.Marker;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const initialAuthState = {
  name: '',
  email: '',
  phone: '',
  password: '',
};

const ALERT_QUEUE_KEY = 'athena_offline_alert_queue';

function GradientButton({ label, onPress, variant = 'danger' }) {
  const colors =
    variant === 'danger'
      ? ['#ff5858', '#f857a6']
      : variant === 'dark'
        ? ['#0f172a', '#1f2937']
        : ['#22c55e', '#14b8a6'];

  return (
    <Pressable style={styles.primaryButton} onPress={onPress}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButtonGradient}>
        <Text style={styles.primaryButtonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [authForm, setAuthForm] = useState(initialAuthState);
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  const [location, setLocation] = useState(null);
  const [isProtectorActive, setIsProtectorActive] = useState(false);
  const [isProtectionActive, setIsProtectionActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentAlertId, setCurrentAlertId] = useState(null);
  const [incomingAlerts, setIncomingAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', relationship: '' });
  const [otpCode, setOtpCode] = useState('');
  const [otpVerificationToken, setOtpVerificationToken] = useState('');
  const [setupStatus, setSetupStatus] = useState(null);
  const [safetyProfileForm, setSafetyProfileForm] = useState({
    homeLatitude: '',
    homeLongitude: '',
    officeLatitude: '',
    officeLongitude: '',
    nightTravelMonitoring: false,
  });
  const [emergencyPinInput, setEmergencyPinInput] = useState('');
  const [stopPinInput, setStopPinInput] = useState('');
  const [victimNote, setVictimNote] = useState('');
  const [autoVerifySeconds, setAutoVerifySeconds] = useState(0);
  const [autoVerificationReason, setAutoVerificationReason] = useState('');

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const soundRef = useRef(null);
  const audioRecordingRef = useRef(null);
  const locationWatcherRef = useRef(null);
  const lastMotionRef = useRef({ speed: 0, timestamp: Date.now() });
  const autoVerificationTimeoutRef = useRef(null);
  const autoVerificationIntervalRef = useRef(null);

  useEffect(() => {
    loadSession();
    registerForPush();
    requestLocationPermission();
    return () => {
      cleanupAudio();
      disconnectSocket();
      locationWatcherRef.current?.remove?.();
      if (autoVerificationTimeoutRef.current) {
        clearTimeout(autoVerificationTimeoutRef.current);
      }
      if (autoVerificationIntervalRef.current) {
        clearInterval(autoVerificationIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!token || !user?.id) {
      return;
    }

    const socket = connectSocket(user.id);
    socket.on('emergency-alert', (payload) => {
      setIncomingAlerts((prev) => [payload, ...prev.filter((a) => a.alertId !== payload.alertId)]);
      setStatusMessage('Emergency alert received nearby');
    });

    socket.on('protector-update', (payload) => {
      setStatusMessage(payload.message || `Protector status: ${payload.status}`);
    });

    return () => {
      socket.off('emergency-alert');
      socket.off('protector-update');
    };
  }, [token, user?.id]);

  useEffect(() => {
    setIsProtectorActive(Boolean(user?.is_protector_active));
  }, [user?.is_protector_active]);

  useEffect(() => {
    if (!token || !location) {
      return;
    }

    syncLocation();
  }, [token, location]);

  useEffect(() => {
    if (!token) {
      return;
    }

    fetchEmergencyContacts();
    fetchSetupStatus();
    fetchSafetyProfile();
    const interval = setInterval(flushOfflineAlerts, 15000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token || !isProtectionActive) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const latest = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation(latest.coords);
      } catch {
        // no-op
      }
    }, 7000);

    return () => clearInterval(interval);
  }, [token, isProtectionActive]);

  const handleShake = useCallback(() => {
    if (!token || isProtectionActive) {
      return;
    }

    activateProtectionMode('Shake detected');
  }, [token, isProtectionActive]);

  useShakeDetection(Boolean(token), handleShake);

  const victimMapRegion = useMemo(() => {
    if (!location) {
      return {
        latitude: 28.6139,
        longitude: 77.209,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }

    return {
      latitude: location.latitude,
      longitude: location.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [location]);

  async function loadSession() {
    const savedToken = await AsyncStorage.getItem('athena_token');
    const savedUser = await AsyncStorage.getItem('athena_user');

    if (savedToken && savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setToken(savedToken);
      setUser(parsedUser);
      setAuthToken(savedToken);
    }
  }

  async function registerForPush() {
    try {
      await Notifications.requestPermissionsAsync();
      await Audio.requestPermissionsAsync();
    } catch {
      // no-op
    }
  }

  async function requestLocationPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Location permission is required for ATHENA.');
      return;
    }

    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLocation(current.coords);

    locationWatcherRef.current?.remove?.();
    locationWatcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 8000,
        distanceInterval: 10,
      },
      (pos) => {
        setLocation(pos.coords);
        detectAnomaly(pos.coords);
      }
    );
  }

  function startSilentVerification(reason) {
    if (isProtectionActive || autoVerificationTimeoutRef.current) {
      return;
    }

    setAutoVerificationReason(reason);
    setAutoVerifySeconds(10);

    autoVerificationIntervalRef.current = setInterval(() => {
      setAutoVerifySeconds((prev) => {
        if (prev <= 1) {
          clearInterval(autoVerificationIntervalRef.current);
          autoVerificationIntervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    autoVerificationTimeoutRef.current = setTimeout(async () => {
      autoVerificationTimeoutRef.current = null;
      if (autoVerificationIntervalRef.current) {
        clearInterval(autoVerificationIntervalRef.current);
        autoVerificationIntervalRef.current = null;
      }
      setAutoVerifySeconds(0);
      await activateProtectionMode(`Auto detection: ${reason}`);
    }, 10000);
  }

  function cancelSilentVerification() {
    if (autoVerificationTimeoutRef.current) {
      clearTimeout(autoVerificationTimeoutRef.current);
      autoVerificationTimeoutRef.current = null;
    }

    if (autoVerificationIntervalRef.current) {
      clearInterval(autoVerificationIntervalRef.current);
      autoVerificationIntervalRef.current = null;
    }

    setAutoVerifySeconds(0);
    setAutoVerificationReason('');
    setStatusMessage('Auto-detection cancelled');
  }

  function detectAnomaly(coords) {
    if (!token || isProtectionActive || !coords) {
      return;
    }

    const now = Date.now();
    const previous = lastMotionRef.current;
    const speed = Number(coords.speed || 0);
    const speedJump = speed - Number(previous.speed || 0);
    const timeDelta = Math.max(1, (now - previous.timestamp) / 1000);
    const normalizedJump = speedJump / timeDelta;

    lastMotionRef.current = { speed, timestamp: now };

    if (speed > 8 && normalizedJump > 1.2) {
      startSilentVerification('sudden running pattern');
      return;
    }

    if (Number(coords.accuracy || 100) < 20 && speed > 12) {
      startSilentVerification('abnormal speed spike');
    }
  }

  async function syncLocation() {
    try {
      await api.patch('/api/auth/location', {
        latitude: location.latitude,
        longitude: location.longitude,
      });
    } catch {
      // no-op on transient failures
    }
  }

  async function loginOrRegister() {
    try {
      const pushToken = await Notifications.getExpoPushTokenAsync().then((p) => p.data).catch(() => null);

      const payload = isRegisterMode
        ? {
            name: authForm.name,
            email: authForm.email,
            phone: authForm.phone,
            password: authForm.password,
            role: 'both',
            otpVerificationToken,
          }
        : {
            email: authForm.email,
            password: authForm.password,
            fcmToken: pushToken,
          };

      const url = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
      const { data } = await api.post(url, payload);

      setToken(data.token);
      setUser(data.user);
      setSetupStatus(data.setup || null);
      setAuthToken(data.token);

      await AsyncStorage.setItem('athena_token', data.token);
      await AsyncStorage.setItem('athena_user', JSON.stringify(data.user));
      setStatusMessage('Authenticated successfully');
    } catch (error) {
      const serverMessage = error.response?.data?.message;
      if (serverMessage) {
        Alert.alert('Authentication failed', serverMessage);
        return;
      }

      const isNetworkError = String(error?.message || '').toLowerCase().includes('network');
      const fallback = isNetworkError
        ? `Network error: cannot reach backend at ${api?.defaults?.baseURL || 'configured URL'}`
        : String(error?.message || 'Please check your details.');

      Alert.alert('Authentication failed', fallback);
    }
  }

  async function requestOtpCode() {
    if (!authForm.phone) {
      Alert.alert('Phone required', 'Enter mobile number to request OTP.');
      return;
    }

    try {
      const { data } = await api.post('/api/auth/request-otp', { phone: authForm.phone });
      const previewText = data?.otpPreview ? ` (dev OTP: ${data.otpPreview})` : '';
      setStatusMessage(`OTP sent successfully${previewText}`);
    } catch (error) {
      Alert.alert('OTP failed', error.response?.data?.message || 'Unable to request OTP');
    }
  }

  async function verifyOtpCode() {
    if (!authForm.phone || !otpCode) {
      Alert.alert('Missing OTP', 'Enter both mobile number and OTP');
      return;
    }

    try {
      const { data } = await api.post('/api/auth/verify-otp', {
        phone: authForm.phone,
        otp: otpCode,
      });
      setOtpVerificationToken(data.otpVerificationToken);
      setStatusMessage('OTP verified. You can create account now.');
    } catch (error) {
      Alert.alert('OTP verify failed', error.response?.data?.message || 'Invalid OTP');
    }
  }

  async function fetchSetupStatus() {
    try {
      const { data } = await api.get('/api/setup-status');
      setSetupStatus(data.setup || null);
    } catch {
      setSetupStatus(null);
    }
  }

  async function fetchSafetyProfile() {
    try {
      const { data } = await api.get('/api/safety-profile');
      if (!data.profile) {
        return;
      }

      setSafetyProfileForm({
        homeLatitude: String(data.profile.home_latitude ?? ''),
        homeLongitude: String(data.profile.home_longitude ?? ''),
        officeLatitude: String(data.profile.office_latitude ?? ''),
        officeLongitude: String(data.profile.office_longitude ?? ''),
        nightTravelMonitoring: Boolean(data.profile.night_travel_monitoring),
      });
    } catch {
      // no-op
    }
  }

  async function saveEmergencyPin() {
    if (!emergencyPinInput || emergencyPinInput.length < 4) {
      Alert.alert('Invalid PIN', 'Emergency PIN must be at least 4 digits');
      return;
    }

    try {
      const { data } = await api.patch('/api/auth/emergency-pin', { pin: emergencyPinInput });
      setSetupStatus(data.setup || setupStatus);
      setEmergencyPinInput('');
      setStatusMessage('Emergency PIN saved');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Unable to save emergency PIN');
    }
  }

  async function saveSafetyProfile() {
    if (
      !safetyProfileForm.homeLatitude ||
      !safetyProfileForm.homeLongitude ||
      !safetyProfileForm.officeLatitude ||
      !safetyProfileForm.officeLongitude
    ) {
      Alert.alert('Missing data', 'Home and Office coordinates are required');
      return;
    }

    try {
      const { data } = await api.put('/api/safety-profile', {
        homeLatitude: Number(safetyProfileForm.homeLatitude),
        homeLongitude: Number(safetyProfileForm.homeLongitude),
        officeLatitude: Number(safetyProfileForm.officeLatitude),
        officeLongitude: Number(safetyProfileForm.officeLongitude),
        nightTravelMonitoring: safetyProfileForm.nightTravelMonitoring,
      });
      setSetupStatus(data.setup || setupStatus);
      setStatusMessage('Safety profile updated');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Unable to save safety profile');
    }
  }

  async function logout() {
    await AsyncStorage.multiRemove(['athena_token', 'athena_user']);
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setIncomingAlerts([]);
    setSelectedAlert(null);
    setCurrentAlertId(null);
    disconnectSocket();
  }

  async function toggleProtectorMode(nextValue) {
    try {
      await api.patch('/api/auth/protector-mode', { isActive: nextValue });
      const updated = { ...user, is_protector_active: nextValue };
      setUser(updated);
      setIsProtectorActive(nextValue);
      await AsyncStorage.setItem('athena_user', JSON.stringify(updated));
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Unable to update protector mode');
    }
  }

  async function activateProtectionMode(reason = 'Emergency button pressed') {
    if (isProtectionActive) {
      return;
    }

    if (!setupStatus?.setupComplete) {
      Alert.alert('Complete setup first', 'Finish OTP, emergency PIN, 2 guardians, and safety profile before using ATHENA emergency mode.');
      return;
    }

    try {
      setIsProtectionActive(true);
      setStatusMessage(`Protection Mode active (${reason})`);

      const locationResult = await Location.getCurrentPositionAsync({});
      setLocation(locationResult.coords);

      await startSirenAndWarning();
      await startAudioRecording();
      await startRecording();

      const alertPayload = {
        latitude: locationResult.coords.latitude,
        longitude: locationResult.coords.longitude,
        triggerType: reason.toLowerCase().includes('voice')
          ? 'voice'
          : reason.toLowerCase().includes('auto')
            ? 'auto'
            : 'manual',
      };

      try {
        const { data } = await api.post('/api/alert', alertPayload);
        setCurrentAlertId(data.alertId);
      } catch {
        await queueOfflineAlert(alertPayload);
        setStatusMessage('Offline mode: alert queued and will auto-send when connected.');
      }

      Vibration.vibrate([500, 500, 500], true);
    } catch (error) {
      Alert.alert('Protection error', error.response?.data?.message || error.message);
      await deactivateProtectionMode();
    }
  }

  async function deactivateProtectionMode(pinOverride = null) {
    const pin = String(pinOverride || stopPinInput || '');
    if (!pin) {
      Alert.alert('PIN required', 'Enter your emergency PIN to stop active emergency.');
      return;
    }

    setIsProtectionActive(false);
    Vibration.cancel();
    cancelSilentVerification();
    await stopSirenAndWarning();
    const audioUri = await stopAudioRecording();
    await stopRecording();

    if (audioUri) {
      await saveAndUploadEvidence(null, audioUri, location);
    }

    if (currentAlertId) {
      try {
        await api.patch(`/api/alerts/${currentAlertId}/close`, {
          pin,
          closureReason: 'resolved_by_victim_pin',
          victimNote: victimNote || null,
        });
      } catch {
        Alert.alert('Close failed', 'Unable to close alert with PIN. Emergency remains active on server.');
      }
    }

    setStopPinInput('');
    setVictimNote('');
    setCurrentAlertId(null);
    setStatusMessage('Protection mode ended');
  }

  async function startSirenAndWarning() {
    Speech.stop();
    Speech.speak('Police warning. Emergency response is active. Stay away.', {
      language: 'en-US',
      pitch: 1,
      rate: 0.9,
      volume: 1,
    });

    cleanupAudio();
    const { sound } = await Audio.Sound.createAsync(
      { uri: 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg' },
      { shouldPlay: true, isLooping: true, volume: 1.0 }
    );
    soundRef.current = sound;
  }

  async function stopSirenAndWarning() {
    Speech.stop();
    await cleanupAudio();
  }

  async function cleanupAudio() {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {
        // no-op
      }
      soundRef.current = null;
    }
  }

  async function ensureCameraReady() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission?.granted) {
        throw new Error('Camera permission not granted');
      }
    }
  }

  async function startRecording() {
    await ensureCameraReady();

    if (!cameraRef.current || isRecording) {
      return;
    }

    setIsRecording(true);

    try {
      const recording = await cameraRef.current.recordAsync({ maxDuration: 300, quality: '720p' });
      if (recording?.uri) {
        await saveAndUploadEvidence(recording.uri, null, location);
      }
    } catch {
      setIsRecording(false);
      return;
    }

    setIsRecording(false);
  }

  async function stopRecording() {
    if (!cameraRef.current || !isRecording) {
      return;
    }

    try {
      await cameraRef.current.stopRecording();
    } catch {
      // no-op
    }

    setIsRecording(false);
  }

  async function startAudioRecording() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      audioRecordingRef.current = recording;
    } catch {
      audioRecordingRef.current = null;
    }
  }

  async function stopAudioRecording() {
    if (!audioRecordingRef.current) {
      return null;
    }

    try {
      await audioRecordingRef.current.stopAndUnloadAsync();
      return audioRecordingRef.current.getURI();
    } catch {
      return null;
    } finally {
      audioRecordingRef.current = null;
    }
  }

  async function saveAndUploadEvidence(videoUri, audioUri, coords) {
    try {
      let localVideoUri = null;
      let localAudioUri = null;

      if (videoUri) {
        const videoName = `athena-evidence-${Date.now()}.mp4`;
        localVideoUri = `${FileSystem.documentDirectory}${videoName}`;
        await FileSystem.copyAsync({ from: videoUri, to: localVideoUri });
      }

      if (audioUri) {
        const audioName = `athena-audio-${Date.now()}.m4a`;
        localAudioUri = `${FileSystem.documentDirectory}${audioName}`;
        await FileSystem.copyAsync({ from: audioUri, to: localAudioUri });
      }

      const formData = new FormData();
      if (localVideoUri) {
        formData.append('video', {
          uri: localVideoUri,
          name: 'evidence.mp4',
          type: 'video/mp4',
        });
      }

      if (localAudioUri) {
        formData.append('audio', {
          uri: localAudioUri,
          name: 'evidence.m4a',
          type: 'audio/m4a',
        });
      }

      if (coords?.latitude && coords?.longitude) {
        formData.append('latitude', String(coords.latitude));
        formData.append('longitude', String(coords.longitude));
      }

      await api.post('/api/evidence/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch {
      // no-op
    }
  }

  async function acceptHelpRequest(alertItem) {
    try {
      await api.post(`/api/alerts/${alertItem.alertId}/respond`, { status: 'accepted' });
      await api.post(`/api/alerts/${alertItem.alertId}/ack`, { actorType: 'protector' });
      setStatusMessage('Response submitted: Protector is coming to help');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Unable to submit response');
    }
  }

  async function escalateAlert(alertItem) {
    try {
      await api.post(`/api/alerts/${alertItem.alertId}/escalate`, {
        escalationType: 'authority_112',
        payload: { source: 'protector_app' },
      });
      setStatusMessage('Escalation logged. Suggested emergency helpline: 112');
    } catch (error) {
      Alert.alert('Escalation failed', error.response?.data?.message || 'Unable to escalate this alert');
    }
  }

  async function updateProtectorProgress(alertItem, status) {
    try {
      await api.patch(`/api/alerts/${alertItem.alertId}/protector-progress`, { status });
      setStatusMessage(`Protector update sent: ${status}`);
    } catch (error) {
      Alert.alert('Update failed', error.response?.data?.message || 'Unable to update protector progress');
    }
  }

  async function queueOfflineAlert(payload) {
    const existing = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    const queue = existing ? JSON.parse(existing) : [];
    queue.push({ payload, timestamp: Date.now() });
    await AsyncStorage.setItem(ALERT_QUEUE_KEY, JSON.stringify(queue));
  }

  async function flushOfflineAlerts() {
    try {
      const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      if (!queue.length) {
        return;
      }

      const remaining = [];
      for (const item of queue) {
        try {
          await api.post('/api/alert', item.payload);
        } catch {
          remaining.push(item);
        }
      }

      await AsyncStorage.setItem(ALERT_QUEUE_KEY, JSON.stringify(remaining));
      if (!remaining.length && queue.length) {
        setStatusMessage('Offline queued alert(s) delivered successfully.');
      }
    } catch {
      // no-op
    }
  }

  async function fetchEmergencyContacts() {
    try {
      const { data } = await api.get('/api/emergency-contacts');
      setContacts(data.contacts || []);
    } catch {
      setContacts([]);
    }
  }

  async function addEmergencyContact() {
    if (!contactForm.name || !contactForm.phone) {
      Alert.alert('Missing fields', 'Contact name and phone are required');
      return;
    }

    if (!contactForm.relationship) {
      Alert.alert('Missing relationship', 'Relationship tag is required');
      return;
    }

    try {
      await api.post('/api/emergency-contacts', {
        contactName: contactForm.name,
        contactPhone: contactForm.phone,
        relationship: contactForm.relationship,
      });
      setContactForm({ name: '', phone: '', relationship: '' });
      await fetchEmergencyContacts();
      await fetchSetupStatus();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Unable to add contact');
    }
  }

  async function removeEmergencyContact(contactId) {
    try {
      await api.delete(`/api/emergency-contacts/${contactId}`);
      await fetchEmergencyContacts();
      await fetchSetupStatus();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Unable to remove contact');
    }
  }

  async function sendSmsWithLocation(contact) {
    const message = `ATHENA EMERGENCY: I need help. My location: https://maps.google.com/?q=${location?.latitude || 0},${location?.longitude || 0}`;
    const smsUrl = `sms:${contact.contact_phone}?body=${encodeURIComponent(message)}`;
    await Linking.openURL(smsUrl);
  }

  async function callContact(contact) {
    await Linking.openURL(`tel:${contact.contact_phone}`);
  }

  async function shareLiveTracking(contact) {
    await Share.share({
      message: `Emergency tracking for ${contact.contact_name}: https://maps.google.com/?q=${location?.latitude || 0},${location?.longitude || 0}`,
    });
  }

  function handleVoiceCommandTrigger() {
    activateProtectionMode('Voice command detected');
  }

  function handlePowerButtonTrigger() {
    activateProtectionMode('Power button multi-press detected');
  }

  if (!token || !user) {
    return (
      <LinearGradient colors={['#0f172a', '#1f2937', '#111827']} style={styles.screen}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.authHero}>
            <Text style={styles.heroTitle}>ATHENA</Text>
            <Text style={styles.heroSubtitle}>Always-on safety. Community-powered protection.</Text>
          </View>
          <View style={styles.authCard}>
            <Text style={styles.sectionTitle}>Welcome</Text>
            <Text style={styles.sectionSub}>Secure your account to activate protection in seconds.</Text>

            {isRegisterMode && (
              <TextInput
                style={styles.input}
                placeholder="Name"
                placeholderTextColor="#9ca3af"
                value={authForm.name}
                onChangeText={(value) => setAuthForm((prev) => ({ ...prev, name: value }))}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              value={authForm.email}
              onChangeText={(value) => setAuthForm((prev) => ({ ...prev, email: value }))}
            />

            {isRegisterMode && (
              <TextInput
                style={styles.input}
                placeholder="Phone"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                value={authForm.phone}
                onChangeText={(value) => setAuthForm((prev) => ({ ...prev, phone: value }))}
              />
            )}

            {isRegisterMode && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="OTP"
                  placeholderTextColor="#9ca3af"
                  keyboardType="number-pad"
                  value={otpCode}
                  onChangeText={setOtpCode}
                />
                <View style={styles.actionRow}>
                  <Pressable style={styles.secondaryButton} onPress={requestOtpCode}>
                    <Text style={styles.secondaryButtonText}>REQUEST OTP</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={verifyOtpCode}>
                    <Text style={styles.secondaryButtonText}>VERIFY OTP</Text>
                  </Pressable>
                </View>
                {!!otpVerificationToken && <Text style={styles.statusOk}>OTP verified successfully</Text>}
              </>
            )}

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              value={authForm.password}
              onChangeText={(value) => setAuthForm((prev) => ({ ...prev, password: value }))}
            />

            <GradientButton label={isRegisterMode ? 'CREATE ACCOUNT' : 'LOGIN'} onPress={loginOrRegister} />

            <Pressable onPress={() => setIsRegisterMode((prev) => !prev)}>
              <Text style={styles.linkText}>
                {isRegisterMode ? 'Already have an account? Login' : "Don't have an account? Register"}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0b1220', '#111827']} style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ProtectionModeOverlay visible={isProtectionActive} onDeactivate={deactivateProtectionMode} />

        <ScrollView contentContainerStyle={styles.mainContent}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.brandPill}>ATHENA</Text>
              <Text style={styles.heading}>Hi {user.name}</Text>
              <Text style={styles.status}>{statusMessage || 'Monitoring active'}</Text>
            </View>
            <Pressable style={styles.logoutButton} onPress={logout}>
              <Text style={styles.logoutText}>Logout</Text>
            </Pressable>
          </View>

          {setupStatus && !setupStatus.setupComplete && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitleDark}>Complete Safety Setup</Text>
              <Text style={styles.setupItem}>Phone verified: {setupStatus.phoneVerified ? 'Yes' : 'No'}</Text>
              <Text style={styles.setupItem}>Emergency PIN: {setupStatus.emergencyPinSet ? 'Set' : 'Not set'}</Text>
              <Text style={styles.setupItem}>Guardians: {setupStatus.contactsCount || 0} / 2 minimum</Text>
              <Text style={styles.setupItem}>Safety profile: {setupStatus.safetyProfileSet ? 'Complete' : 'Incomplete'}</Text>

              <TextInput
                style={styles.input}
                placeholder="Emergency PIN (min 4 digits)"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                keyboardType="number-pad"
                value={emergencyPinInput}
                onChangeText={setEmergencyPinInput}
              />
              <GradientButton label="SAVE EMERGENCY PIN" onPress={saveEmergencyPin} variant="dark" />

              <TextInput
                style={styles.input}
                placeholder="Home Latitude"
                placeholderTextColor="#9ca3af"
                keyboardType="decimal-pad"
                value={safetyProfileForm.homeLatitude}
                onChangeText={(value) => setSafetyProfileForm((prev) => ({ ...prev, homeLatitude: value }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Home Longitude"
                placeholderTextColor="#9ca3af"
                keyboardType="decimal-pad"
                value={safetyProfileForm.homeLongitude}
                onChangeText={(value) => setSafetyProfileForm((prev) => ({ ...prev, homeLongitude: value }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Office/College Latitude"
                placeholderTextColor="#9ca3af"
                keyboardType="decimal-pad"
                value={safetyProfileForm.officeLatitude}
                onChangeText={(value) => setSafetyProfileForm((prev) => ({ ...prev, officeLatitude: value }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Office/College Longitude"
                placeholderTextColor="#9ca3af"
                keyboardType="decimal-pad"
                value={safetyProfileForm.officeLongitude}
                onChangeText={(value) => setSafetyProfileForm((prev) => ({ ...prev, officeLongitude: value }))}
              />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Night travel monitoring</Text>
                <Switch
                  value={safetyProfileForm.nightTravelMonitoring}
                  onValueChange={(value) => setSafetyProfileForm((prev) => ({ ...prev, nightTravelMonitoring: value }))}
                />
              </View>
              <GradientButton label="SAVE SAFETY PROFILE" onPress={saveSafetyProfile} variant="dark" />
            </View>
          )}

          {autoVerifySeconds > 0 && (
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>Silent verification running ({autoVerifySeconds}s)</Text>
              <Text style={styles.alertMeta}>Reason: {autoVerificationReason || 'Anomaly detected'}</Text>
              <Pressable style={styles.secondaryButton} onPress={cancelSilentVerification}>
                <Text style={styles.secondaryButtonText}>I AM SAFE - CANCEL</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.heroCard}>
            <Text style={styles.heroCardTitle}>Protection Center</Text>
            <Text style={styles.heroCardSub}>Instant emergency alert + auto evidence capture</Text>
            <GradientButton label="EMERGENCY" onPress={() => activateProtectionMode()} />
            <View style={styles.heroActions}>
              <Pressable style={styles.secondaryButton} onPress={handleVoiceCommandTrigger}>
                <Text style={styles.secondaryButtonText}>VOICE HELP</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={handlePowerButtonTrigger}>
                <Text style={styles.secondaryButtonText}>POWER x3</Text>
              </Pressable>
            </View>
          </View>

          {isProtectionActive && (
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>Stop Emergency (PIN required)</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter emergency PIN"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                keyboardType="number-pad"
                value={stopPinInput}
                onChangeText={setStopPinInput}
              />
              <TextInput
                style={styles.input}
                placeholder="Emergency note (optional)"
                placeholderTextColor="#9ca3af"
                value={victimNote}
                onChangeText={setVictimNote}
              />
              <GradientButton label="STOP EMERGENCY" onPress={() => deactivateProtectionMode()} variant="dark" />
            </View>
          )}

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitleDark}>Protector Network</Text>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>Protector Mode</Text>
              <Switch value={isProtectorActive} onValueChange={toggleProtectorMode} />
            </View>
            <Text style={styles.sectionSub}>
              {isProtectorActive ? 'You are visible to nearby alerts.' : 'Enable to help others in real time.'}
            </Text>
          </View>

          <Text style={styles.sectionTitleLight}>My Location</Text>
        {Platform.OS === 'web' ? (
          <View style={[styles.map, styles.webMapFallback]}>
            <Text style={styles.webMapText}>Map preview is available on Android/iOS builds.</Text>
            {location && (
              <Text style={styles.webMapSubText}>
                Your coordinates: {Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}
              </Text>
            )}
          </View>
        ) : (
          <NativeMapView style={styles.map} region={victimMapRegion}>
            {location && (
              <NativeMarker
                coordinate={{ latitude: location.latitude, longitude: location.longitude }}
                title="You"
                description="Current location"
              />
            )}
          </NativeMapView>
        )}

        <Camera
          ref={cameraRef}
          type={CameraType.back}
          flashMode={isProtectionActive ? FlashMode.torch : FlashMode.off}
          style={styles.cameraPreview}
        />

        <Text style={styles.sectionTitleLight}>Nearby Emergency Alerts</Text>
        <FlatList
          data={incomingAlerts}
          keyExtractor={(item) => String(item.alertId)}
          scrollEnabled={false}
          ListEmptyComponent={<Text style={styles.emptyText}>No active nearby alerts</Text>}
          renderItem={({ item }) => (
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>Alert #{item.alertId}</Text>
              <Text style={styles.alertMeta}>Victim ID: {item.victimId}</Text>
              <Text style={styles.alertMeta}>
                Location: {Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}
              </Text>
              <View style={styles.actionRow}>
                <Pressable style={styles.secondaryButton} onPress={() => setSelectedAlert(item)}>
                  <Text style={styles.secondaryButtonText}>VIEW MAP</Text>
                </Pressable>
                <GradientButton label="ACCEPT TO HELP" onPress={() => acceptHelpRequest(item)} variant="success" />
              </View>
              <View style={styles.actionRow}>
                <Pressable style={styles.secondaryButton} onPress={() => updateProtectorProgress(item, 'enroute')}>
                  <Text style={styles.secondaryButtonText}>ENROUTE</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => updateProtectorProgress(item, 'arrived')}>
                  <Text style={styles.secondaryButtonText}>ARRIVED</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => escalateAlert(item)}>
                  <Text style={styles.secondaryButtonText}>ESCALATE 112</Text>
                </Pressable>
              </View>
            </View>
          )}
        />

        <Text style={styles.sectionTitleLight}>Emergency Contacts</Text>
        <View style={styles.alertCard}>
          <TextInput
            style={styles.input}
            placeholder="Contact Name"
            placeholderTextColor="#9ca3af"
            value={contactForm.name}
            onChangeText={(value) => setContactForm((prev) => ({ ...prev, name: value }))}
          />
          <TextInput
            style={styles.input}
            placeholder="Contact Phone"
            placeholderTextColor="#9ca3af"
            keyboardType="phone-pad"
            value={contactForm.phone}
            onChangeText={(value) => setContactForm((prev) => ({ ...prev, phone: value }))}
          />
          <TextInput
            style={styles.input}
            placeholder="Relationship"
            placeholderTextColor="#9ca3af"
            value={contactForm.relationship}
            onChangeText={(value) => setContactForm((prev) => ({ ...prev, relationship: value }))}
          />
          <GradientButton label="ADD CONTACT" onPress={addEmergencyContact} variant="dark" />
        </View>

        <FlatList
          data={contacts}
          keyExtractor={(item) => String(item.id)}
          scrollEnabled={false}
          ListEmptyComponent={<Text style={styles.emptyText}>No emergency contacts added</Text>}
          renderItem={({ item }) => (
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>{item.contact_name}</Text>
              <Text style={styles.alertMeta}>{item.contact_phone}</Text>
              <Text style={styles.alertMeta}>{item.relationship || 'Emergency Contact'}</Text>
              <View style={styles.actionRow}>
                <Pressable style={styles.secondaryButton} onPress={() => callContact(item)}>
                  <Text style={styles.secondaryButtonText}>CALL</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => sendSmsWithLocation(item)}>
                  <Text style={styles.secondaryButtonText}>SMS</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => shareLiveTracking(item)}>
                  <Text style={styles.secondaryButtonText}>SHARE</Text>
                </Pressable>
              </View>
              <GradientButton label="REMOVE" onPress={() => removeEmergencyContact(item.id)} variant="danger" />
            </View>
          )}
        />

        {selectedAlert && (
          <View style={styles.routeCard}>
            <Text style={styles.sectionTitleDark}>Protector Navigation</Text>
            {Platform.OS === 'web' ? (
              <View style={[styles.map, styles.webMapFallback]}>
                <Text style={styles.webMapText}>Victim map routing is available on Android/iOS builds.</Text>
                <Text style={styles.webMapSubText}>
                  Victim: {Number(selectedAlert.latitude).toFixed(5)}, {Number(selectedAlert.longitude).toFixed(5)}
                </Text>
                {location && (
                  <Text style={styles.webMapSubText}>
                    You: {Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}
                  </Text>
                )}
              </View>
            ) : (
              <NativeMapView
                style={styles.map}
                region={{
                  latitude: Number(selectedAlert.latitude),
                  longitude: Number(selectedAlert.longitude),
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
              >
                <NativeMarker
                  coordinate={{
                    latitude: Number(selectedAlert.latitude),
                    longitude: Number(selectedAlert.longitude),
                  }}
                  title="Victim"
                />
                {location && (
                  <NativeMarker coordinate={{ latitude: location.latitude, longitude: location.longitude }} title="You" />
                )}
              </NativeMapView>
            )}
            <Pressable style={styles.secondaryButton} onPress={() => setSelectedAlert(null)}>
              <Text style={styles.secondaryButtonText}>CLOSE MAP</Text>
            </Pressable>
          </View>
        )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  mainContent: {
    padding: 16,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brandPill: {
    color: '#fda4af',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  logoutText: {
    color: '#f9fafb',
    fontWeight: '700',
  },
  authCard: {
    margin: 16,
    padding: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    gap: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  authHero: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#f9fafb',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
  },
  heroSubtitle: {
    color: '#cbd5f5',
    marginTop: 6,
    fontSize: 14,
  },
  heroCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  heroCardTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '800',
  },
  heroCardSub: {
    color: '#cbd5f5',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  heroActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'left',
    color: '#0f172a',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
  },
  subtitle: {
    textAlign: 'left',
    color: '#64748b',
    marginBottom: 10,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f9fafb',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
  },
  status: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
  },
  primaryButton: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryButtonGradient: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryButtonText: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  linkText: {
    textAlign: 'center',
    color: '#f9a8d4',
    marginTop: 6,
    fontWeight: '700',
  },
  sectionTitleLight: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 6,
    color: '#f8fafc',
  },
  sectionTitleDark: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    color: '#0f172a',
  },
  sectionSub: {
    color: '#cbd5f5',
    fontSize: 13,
    marginTop: 4,
  },
  setupItem: {
    color: '#1e293b',
    fontWeight: '600',
    marginBottom: 4,
  },
  statusOk: {
    color: '#22c55e',
    fontWeight: '700',
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  map: {
    width: '100%',
    height: 220,
    borderRadius: 10,
    overflow: 'hidden',
  },
  cameraPreview: {
    height: 200,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 10,
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
  },
  alertCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    gap: 4,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  alertTitle: {
    fontWeight: '800',
    color: '#0f172a',
  },
  alertMeta: {
    color: '#475569',
  },
  routeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    gap: 8,
  },
  webMapFallback: {
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  webMapText: {
    color: '#0f172a',
    fontWeight: '700',
    textAlign: 'center',
  },
  webMapSubText: {
    marginTop: 8,
    color: '#64748b',
    textAlign: 'center',
  },
});
