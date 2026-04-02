import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

const SHAKE_THRESHOLD = 2.2;
const COOLDOWN_MS = 3000;

export default function useShakeDetection(isEnabled, onShake) {
  const lastTriggerRef = useRef(0);

  useEffect(() => {
    if (!isEnabled) {
      return undefined;
    }

    Accelerometer.setUpdateInterval(200);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const acceleration = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();

      if (acceleration > SHAKE_THRESHOLD && now - lastTriggerRef.current > COOLDOWN_MS) {
        lastTriggerRef.current = now;
        onShake?.();
      }
    });

    return () => subscription.remove();
  }, [isEnabled, onShake]);
}
