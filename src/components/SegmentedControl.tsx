import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ColorScheme } from '../styles/theme';
import { radii } from '../styles/theme';

type Option<T extends string> = {
  label: string;
  value: T;
};

type SegmentedControlProps<T extends string> = {
  colors: ColorScheme;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

export const SegmentedControl = <T extends string>({
  colors,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) => (
  <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
    {options.map((option) => {
      const isActive = option.value === value;

      return (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: isActive }}
          key={option.value}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => [
            styles.segment,
            isActive && { backgroundColor: colors.surface },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.segmentText, { color: isActive ? colors.text : colors.textMuted }]}>
            {option.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  segmented: {
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
