import { usePathname, useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const BottomTab = () => {
  const router = useRouter();
  const pathname = usePathname(); // Get the current path

  const tabs = [
    { key: 'home', label: 'Home', route: '/home/home' },
    { key: 'profile', label: 'Profile', route: '/profile/profile' },
  ];

  const handleTabPress = (route) => {
    if (pathname !== route) {
      router.push(route);
    }
  };

  const isActiveTab = (route) => pathname === route;

  return (
    <View style={styles.container}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[
            styles.tabButton,
            isActiveTab(tab.route) && styles.activeTabButton
          ]}
          onPress={() => handleTabPress(tab.route)}
          accessibilityRole="tab"
          accessibilityLabel={`Navigate to ${tab.label}`}
          accessibilityState={{ selected: isActiveTab(tab.route) }}
        >
          <Text 
            style={[
              styles.tabText,
              isActiveTab(tab.route) && styles.activeTabText
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e1e5e9',
    minHeight: 64,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 44,
  },
  activeTabButton: {
    backgroundColor: '#f0f8ff',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'black',
    textAlign: 'center',
  },
  activeTabText: {
    color: 'black',
    fontWeight: '600',
  },
});

export default BottomTab;