import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';

interface ConfettiProps {
  active: boolean;
  count?: number;
}

const PALETTE = [colors.primary, colors.primaryDark, colors.warning, colors.white];

interface Particle {
  id: number;
  left: number; // % horizontal dentro del contenedor
  size: number;
  color: string;
  delay: number;
  duration: number;
  drift: number; // deriva horizontal en px al caer
  rotations: number;
}

function buildParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    size: 6 + Math.random() * 6,
    color: PALETTE[i % PALETTE.length],
    delay: Math.random() * 250,
    duration: 1800 + Math.random() * 900,
    drift: (Math.random() - 0.5) * 120,
    rotations: 2 + Math.random() * 3,
  }));
}

// Lluvia de confetti liviana hecha con Animated -- sin librerías nuevas.
// Pensada para dispararse una vez por cada flanco false->true de `active`
// (un modal que se abre), no para un loop continuo.
export default function Confetti({ active, count = 26 }: ConfettiProps) {
  const particles = useMemo(() => buildParticles(count), [count]);
  const progress = useRef(particles.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) return;
    progress.forEach((v) => v.setValue(0));
    const animations = particles.map((p, i) =>
      Animated.timing(progress[i], {
        toValue: 1,
        duration: p.duration,
        delay: p.delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    Animated.stagger(15, animations).start();
    // Solo nos importa el flanco de subida de `active` -- progress/particles
    // son estables entre renders (useRef/useMemo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((p, i) => {
        const translateY = progress[i].interpolate({ inputRange: [0, 1], outputRange: [-20, 260] });
        const translateX = progress[i].interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = progress[i].interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${p.rotations * 360}deg`],
        });
        const opacity = progress[i].interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });

        return (
          <Animated.View
            key={p.id}
            style={[
              styles.particle,
              {
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 0.4,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateY }, { translateX }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
    overflow: 'hidden',
  },
  particle: {
    position: 'absolute',
    borderRadius: 2,
  },
});
