import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { toQR } from "toqr";

export function QrMatrix({ value, size = 280 }: { value: string; size?: number }) {
  const matrix = useMemo(() => toQR(value), [value]);
  const side = Math.sqrt(matrix.length);
  const quiet = 4;
  const cell = size / (side + quiet * 2);
  return (
    <View
      accessibilityLabel="Nepal Hand Pay QR code"
      accessibilityRole="image"
      style={[styles.canvas, { width: size, height: size, padding: cell * quiet }]}
    >
      {Array.from({ length: side }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: side }, (_unused, column) => (
            <View
              key={column}
              style={{
                width: cell,
                height: cell,
                backgroundColor: matrix[row * side + column]
                  ? "#06271e"
                  : "white",
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    alignSelf: "center",
    backgroundColor: "white",
    borderRadius: 18,
    overflow: "hidden",
  },
  row: { flexDirection: "row" },
});
