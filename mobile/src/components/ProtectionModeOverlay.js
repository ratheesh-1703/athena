import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';

export default function ProtectionModeOverlay({ visible, onDeactivate }) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>PROTECTION MODE ACTIVE</Text>
      <Text style={styles.subtitle}>RECORDING IN PROGRESS</Text>
      <Text style={styles.subtitle}>ALERT SENT TO NEARBY PROTECTORS</Text>
      <Text style={styles.warning}>Keep this screen open until you are safe.</Text>
      <Pressable style={styles.button} onLongPress={onDeactivate} delayLongPress={2500}>
        <Text style={styles.buttonText}>HOLD 2.5s TO EXIT</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#8b0000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 20,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 14,
    textAlign: 'center',
  },
  subtitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  warning: {
    color: '#ffe0e0',
    marginTop: 24,
    marginBottom: 30,
    textAlign: 'center',
    fontSize: 16,
  },
  button: {
    backgroundColor: '#111',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
