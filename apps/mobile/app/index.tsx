import { Text, View, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>KeyKeyKey</Text>
      <Text style={styles.subtitle}>Your credentials, your cloud, your keys.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#6366F1',
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    marginTop: 8,
  },
});
