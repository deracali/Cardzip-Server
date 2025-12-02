import { Stack } from 'expo-router';

const App = () => (
  <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="home/home" options={{ headerShown: false }} />
    <Stack.Screen name="form/cardForm" options={{ headerShown: false }} />
    <Stack.Screen name="profile/profile" options={{ headerShown: false }} />
    <Stack.Screen name="success/successScreen" options={{ headerShown: false }} />
  </Stack>
);

export default App;
