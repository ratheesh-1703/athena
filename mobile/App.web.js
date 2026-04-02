import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { setAuthToken } from './src/services/api';

const initialAuthState = { name: '', email: '', phone: '', password: '' };

export default function AppWeb() {
  const [authForm, setAuthForm] = useState(initialAuthState);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isProtectorActive, setIsProtectorActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [lastAlert, setLastAlert] = useState(null);
  const [activity, setActivity] = useState([]);

  const heading = useMemo(() => (user ? `Welcome back, ${user.name}` : 'ATHENA'), [user]);

  useEffect(() => {
    loadSession();
  }, []);

  async function loadSession() {
    try {
      const savedToken = await AsyncStorage.getItem('athena_token');
      const savedUser = await AsyncStorage.getItem('athena_user');

      if (savedToken && savedUser) {
        const parsedUser = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
        setIsProtectorActive(Boolean(parsedUser?.is_protector_active));
        setAuthToken(savedToken);
        setStatusMessage('Session restored');
      }
    } catch {
      setStatusMessage('Session restore failed');
    }
  }

  function pushActivity(message) {
    setActivity((prev) => [{ message, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 6));
  }

  async function loginOrRegister() {
    try {
      const payload = isRegisterMode
        ? {
            name: authForm.name,
            email: authForm.email,
            phone: authForm.phone,
            password: authForm.password,
            role: 'both',
          }
        : {
            email: authForm.email,
            password: authForm.password,
          };

      const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
      const { data } = await api.post(endpoint, payload);

      setToken(data.token);
      setUser(data.user);
      setIsProtectorActive(Boolean(data.user?.is_protector_active));
      setAuthToken(data.token);
      await AsyncStorage.setItem('athena_token', data.token);
      await AsyncStorage.setItem('athena_user', JSON.stringify(data.user));
      setStatusMessage('Authenticated successfully');
      pushActivity(`${isRegisterMode ? 'Registered' : 'Logged in'} as ${data.user.name}`);
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Authentication failed');
    }
  }

  async function toggleProtectorMode(nextValue) {
    try {
      await api.patch('/api/auth/protector-mode', { isActive: nextValue });
      setIsProtectorActive(nextValue);
      setStatusMessage(`Protector Mode ${nextValue ? 'enabled' : 'disabled'}`);
      pushActivity(`Protector Mode ${nextValue ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Failed to update mode');
    }
  }

  async function sendEmergencyAlert() {
    if (!token) {
      setStatusMessage('Login first to trigger emergency alert');
      return;
    }

    try {
      const latitude = 28.6139;
      const longitude = 77.2090;
      const { data } = await api.post('/api/alert', { latitude, longitude });
      setLastAlert(data);
      setStatusMessage(`Alert #${data.alertId} sent successfully`);
      pushActivity(`Emergency alert #${data.alertId} sent`);
    } catch (error) {
      setStatusMessage(error.response?.data?.message || 'Failed to send alert');
    }
  }

  async function logout() {
    setToken(null);
    setUser(null);
    setIsProtectorActive(false);
    setAuthToken(null);
    setLastAlert(null);
    setActivity([]);
    await AsyncStorage.multiRemove(['athena_token', 'athena_user']);
    setStatusMessage('Logged out');
  }

  if (!token || !user) {
    return (
      <LinearGradient colors={['#0f172a', '#1f2937', '#111827']} style={styles.screen}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.authHero}>
            <Text style={styles.heroTitle}>ATHENA</Text>
            <Text style={styles.heroSubtitle}>Always-on safety. Community-powered protection.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{heading}</Text>
            <Text style={styles.subtitle}>Secure your account to activate protection instantly.</Text>

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
              value={authForm.email}
              autoCapitalize="none"
              onChangeText={(value) => setAuthForm((prev) => ({ ...prev, email: value }))}
            />

            {isRegisterMode && (
              <TextInput
                style={styles.input}
                placeholder="Phone"
                placeholderTextColor="#9ca3af"
                value={authForm.phone}
                onChangeText={(value) => setAuthForm((prev) => ({ ...prev, phone: value }))}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              value={authForm.password}
              onChangeText={(value) => setAuthForm((prev) => ({ ...prev, password: value }))}
            />

            <Pressable style={styles.primaryButton} onPress={loginOrRegister}>
              <LinearGradient colors={['#ff5858', '#f857a6']} style={styles.primaryButtonGradient}>
                <Text style={styles.primaryButtonText}>{isRegisterMode ? 'REGISTER' : 'LOGIN'}</Text>
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => setIsRegisterMode((prev) => !prev)}>
              <Text style={styles.linkText}>
                {isRegisterMode ? 'Already have an account? Login' : "Don't have an account? Register"}
              </Text>
            </Pressable>

            <Text style={styles.status}>{statusMessage}</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0b1220', '#111827']} style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>ATHENA</Text>
            <Text style={styles.headerTitle}>{heading}</Text>
            <Text style={styles.status}>{statusMessage}</Text>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.dashboardContent}>
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>Safety Status</Text>
            <Text style={styles.statusValue}>Monitoring Active</Text>
            <Text style={styles.statusSub}>Rapid alerting + evidence capture ready</Text>
            <Pressable style={styles.primaryButton} onPress={sendEmergencyAlert}>
              <LinearGradient colors={['#ff5858', '#f857a6']} style={styles.primaryButtonGradient}>
                <Text style={styles.primaryButtonText}>ACTIVATE EMERGENCY ALERT</Text>
              </LinearGradient>
            </Pressable>
            {lastAlert && (
              <View style={styles.inlineInfo}>
                <Text style={styles.inlineInfoText}>Latest Alert ID: {lastAlert.alertId}</Text>
                <Text style={styles.inlineInfoText}>
                  Nearby Protectors Notified: {lastAlert.nearbyProtectors?.length || 0}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.sectionCard}> 
            <Text style={styles.sectionTitle}>Protector Network</Text>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>Protector Mode</Text>
              <Switch value={isProtectorActive} onValueChange={toggleProtectorMode} />
            </View>
            <Text style={styles.sectionSub}>
              {isProtectorActive
                ? 'You are visible to nearby emergency requests.'
                : 'Enable this to receive and respond to nearby emergency alerts.'}
            </Text>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Incident Activity</Text>
            {activity.length === 0 ? (
              <Text style={styles.emptyText}>No recent activity yet.</Text>
            ) : (
              activity.map((item, index) => (
                <View key={`${item.timestamp}-${index}`} style={styles.activityRow}>
                  <Text style={styles.activityMessage}>{item.message}</Text>
                  <Text style={styles.activityTime}>{item.timestamp}</Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Account</Text>
            <Text style={styles.profileLine}>Name: {user.name}</Text>
            <Text style={styles.profileLine}>Email: {user.email}</Text>
            <Text style={styles.profileLine}>Phone: {user.phone}</Text>
            <Text style={styles.profileLine}>Role: {user.role}</Text>
          </View>

          <Text style={styles.note}>
            Web dashboard is fully functional for auth and alerts. Camera, microphone, and sensors are active in mobile builds.
          </Text>
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
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    alignSelf: 'center',
    boxShadow: '0px 12px 24px rgba(15, 23, 42, 0.2)',
  },
  authHero: {
    paddingHorizontal: 20,
    paddingTop: 18,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#f9fafb',
    fontFamily: 'Georgia',
  },
  heroSubtitle: {
    color: '#cbd5f5',
    marginTop: 6,
    fontSize: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'left',
    fontFamily: 'Georgia',
  },
  dashboardContainer: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  header: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  brand: {
    color: '#fda4af',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    color: '#f9fafb',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
    fontFamily: 'Georgia',
  },
  logoutButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  logoutButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  dashboardContent: {
    paddingBottom: 20,
    gap: 10,
  },
  statusCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statusTitle: {
    color: '#fecaca',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  statusValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 4,
  },
  statusSub: {
    color: '#e2e8f0',
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    gap: 8,
    boxShadow: '0px 8px 18px rgba(15, 23, 42, 0.08)',
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: 'Georgia',
  },
  sectionSub: {
    color: '#6b7280',
    fontSize: 13,
  },
  subtitle: {
    textAlign: 'left',
    color: '#64748b',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    color: '#0f172a',
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  linkText: {
    textAlign: 'center',
    color: '#f9a8d4',
    fontWeight: '700',
  },
  status: {
    color: '#cbd5f5',
    marginTop: 4,
  },
  inlineInfo: {
    marginTop: 6,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  inlineInfoText: {
    color: '#374151',
    fontSize: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
  },
  label: {
    fontWeight: '700',
  },
  activityRow: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
  },
  activityMessage: {
    color: '#111827',
    fontWeight: '600',
  },
  activityTime: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: '#6b7280',
  },
  profileLine: {
    color: '#1f2937',
    fontSize: 13,
  },
  note: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
});
