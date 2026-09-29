import { Redirect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { BrandMark, Loading } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";

export default function IndexScreen() {
  const { user, loading } = useAuth();
  if (!loading) return <Redirect href={user ? "/(tabs)" : "/(auth)/login"} />;
  return (
    <View style={styles.container}>
      <BrandMark />
      <Loading label="Restoring your secure session…" />
      <Text style={styles.prototype}>Prototype wallet · No real money</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 28,
    paddingTop: 90,
    backgroundColor: colors.background,
  },
  prototype: { color: colors.slate500, textAlign: "center", fontSize: 12 },
});
