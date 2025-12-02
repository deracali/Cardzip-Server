import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    Image
} from 'react-native';
import BottomTab from '../../components/tab/tab';

const { width, height } = Dimensions.get('window');

const GiftCardHomePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const router = useRouter();

  const categories = [
    { id: 1, name: 'All' },
    { id: 2, name: 'Entertainment' },
    { id: 3, name: 'Shopping' },
    { id: 4, name: 'Food' },
    { id: 5, name: 'Gaming' },
  ];

const cardNumberLengths = {
  Amazon: 14,
  Netflix: 11,
  Spotify: 12,
  Steam: 15,
  Starbucks: 16,
  iTunes: 16,
  RazorGold: 12,
  GooglePlay: 20,
  Xbox: 25,
  Playstation: 12,
  Nintendo: 16,
  Walmart: 16,
  Google: 20,
  Uber: 15,
  Target: 15,
};


//
// const emojiMap = {
//   "Amazon": "🛒",
//   "iTunes": "🎵",
//   "GooglePlay": "▶️",
//   "Google Play": "▶️",
//   "Apple": "🍎",
//   "Target": "🎯",
//   "Steam": "🎮",
//   "Netflix": "📺",
//   "Walmart": "🏪",
//   "eBay": "💰",
//   "Playstation": "🕹️",
//   "PlayStation": "🕹️",
//   "Roblox": "🧱",
//   "Spotify": "🎧",
//   "Uber": "🚗",
//   "Starbucks": "☕",
//   "Xbox": "🎮",
//   "RazorGold": "💎",
//   "Nintendo": "🎮"
// };




const imageMap = {
  // "Amazon": require('@/assets/images/amazon.png'),
  "iTunes": require('@/assets/images/apple.png'),
  "GooglePlay": require('@/assets/images/google.png'),
  // "Apple": require('@/assets/images/apple.png'),
  "Macy": require('@/assets/images/macy.png'),
  "Steam": require('@/assets/images/steam.png'),
  "Footlocker": require('@/assets/images/footlocker.png'),
  "Nike": require('@/assets/images/nike.png'),
  // "eBay": require('@/assets/images/ebay.png'),
  "Roblox": require('@/assets/images/roblox.png'),
  "Xbox": require('@/assets/images/xbox.png'),
  "RazorGold": require('@/assets/images/razorgold.png'),
  "Default": require('@/assets/images/default.svg'),
};


 const [giftCards, setGiftCards] = useState([]);

 useEffect(() => {
    fetch('https://trader-sr5j-0k7o.onrender.com/api/cards/get')
      .then(response => response.json())
      .then(result => {
    if (Array.isArray(result.data)) {
      const enrichedCards = result.data.map(card => ({
        ...card,
        image: imageMap[card.name] || imageMap["Default"],
      }));
      setGiftCards(enrichedCards);
    } else {
      console.error('Unexpected response format:', result);
    }
  })

      .catch(error => {
        console.error('Failed to fetch gift cards:', error);
        Alert.alert('Error', 'Could not load gift cards.');
      });
  }, []);

  const renderGiftCard = (card) => (
    <TouchableOpacity key={card._id} style={styles.giftCard}>
      {card.popular && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularText}>🔥 Popular</Text>
        </View>
      )}
      <View style={[styles.cardIcon, { backgroundColor: card.color }]}>
    <Image
      source={card.image}
      style={{ width: 50, height: 50, borderRadius: 8 }}
      resizeMode="contain"
    />
  </View>

      <Text style={styles.cardName}>{card.name}</Text>
      <Text style={styles.cardCategory}>{card.category}</Text>
      <View style={styles.discountContainer}>
        <Text style={styles.discountText}>{card.discount}</Text>
      </View>
      <TouchableOpacity
        style={styles.buyButton}
        onPress={() =>
          router.push({
            pathname: 'form/cardForm',
            params: { card: JSON.stringify(card) },
          })
        }
      >
        <Text style={styles.buyButtonText}>Trade</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const filteredCards = giftCards.filter(card =>
    (selectedCategory === 'All' || card.category === selectedCategory) &&
    card.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // const renderGiftCard = (card) => (
  //   <TouchableOpacity key={card.id} style={styles.giftCard}>
  //     {card.popular && (
  //       <View style={styles.popularBadge}>
  //         <Text style={styles.popularText}>🔥 Popular</Text>
  //       </View>
  //     )}
  //     <View style={[styles.cardIcon, { backgroundColor: card.color }]}>
  //       <Text style={styles.cardEmoji}>{card.image}</Text>
  //     </View>
  //     <Text style={styles.cardName}>{card.name}</Text>
  //     <Text style={styles.cardCategory}>{card.category}</Text>
  //     <View style={styles.discountContainer}>
  //       <Text style={styles.discountText}>{card.discount}</Text>
  //     </View>
  //   <TouchableOpacity
  //     style={styles.buyButton}
  //     onPress={() =>
  //       router.push({
  //         pathname: 'form/cardForm',
  //         params: { card: JSON.stringify(card) }, // ✅ pass full card data
  //       })
  //     }
  //   >
  //     <Text style={styles.buyButtonText}>Trade</Text>
  //   </TouchableOpacity>
  //   </TouchableOpacity>
  // );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="black" />
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.welcomeText}>Welcome back! 👋</Text>
              <Text style={styles.headerTitle}>Buy Gift Cards</Text>
            </View>
           <TouchableOpacity
  style={styles.profileButton}
  onPress={() => router.push('profile/profile')}
>
  <Text style={styles.profileIcon}>👤</Text>
</TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search gift cards..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#9ca3af"
          />
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>500+</Text>
            <Text style={styles.statLabel}>Gift Cards</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>Up to 20%</Text>
            <Text style={styles.statLabel}>Discounts</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>Instant</Text>
            <Text style={styles.statLabel}>Delivery</Text>
          </View>
        </View>

        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {categories.map((category) => (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.categoryButton,
                  selectedCategory === category.name && styles.categoryButtonSelected
                ]}
                onPress={() => setSelectedCategory(category.name)}
              >
                <Text
                  style={[
                    styles.categoryText,
                    selectedCategory === category.name && styles.categoryTextSelected
                  ]}
                >
                  {category.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {selectedCategory === 'All' ? 'Popular Gift Cards' : `${selectedCategory} Cards`}
            </Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.giftCardsGrid}>
            {filteredCards.map(renderGiftCard)}
          </View>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
        <BottomTab />
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  scrollContainer: {
    flex: 1,
    paddingHorizontal: width * 0.05,
  },
  header: {
    marginTop: height * 0.02,
    marginBottom: height * 0.03,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: width * 0.04,
    color: '#6b7280',
    marginBottom: height * 0.005,
  },
  headerTitle: {
    fontSize: width * 0.07,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  profileButton: {
    width: width * 0.12,
    height: width * 0.12,
    borderRadius: width * 0.06,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  profileIcon: {
    fontSize: width * 0.06,
    color: '#ffffff',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: width * 0.04,
    marginBottom: height * 0.03,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  searchIcon: {
    fontSize: width * 0.05,
    marginRight: width * 0.03,
  },
  searchInput: {
    flex: 1,
    height: height * 0.06,
    fontSize: width * 0.04,
    color: '#1f2937',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: height * 0.03,
  },
  statCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: width * 0.04,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: width * 0.01,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: width * 0.045,
    fontWeight: 'bold',
    color: 'black',
    marginBottom: height * 0.005,
  },
  statLabel: {
    fontSize: width * 0.03,
    color: '#6b7280',
  },
  sectionContainer: {
    marginBottom: height * 0.03,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: height * 0.02,
  },
  sectionTitle: {
    fontSize: width * 0.05,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  seeAllText: {
    fontSize: width * 0.035,
    color: 'black',
    fontWeight: '600',
  },
  categoryScroll: {
    marginTop: height * 0.015,
  },
  categoryButton: {
    backgroundColor: '#ffffff',
    paddingHorizontal: width * 0.05,
    paddingVertical: height * 0.015,
    borderRadius: 20,
    marginRight: width * 0.03,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  categoryButtonSelected: {
    backgroundColor: 'black',
    borderColor: 'black',
  },
  categoryText: {
    fontSize: width * 0.035,
    color: '#6b7280',
    fontWeight: '500',
  },
  categoryTextSelected: {
    color: '#ffffff',
  },
  giftCardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  giftCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: width * 0.04,
    width: (width - width * 0.15) / 2,
    marginBottom: height * 0.02,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: width * 0.02,
    right: width * 0.02,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: width * 0.02,
    paddingVertical: height * 0.005,
    zIndex: 1,
  },
  popularText: {
    fontSize: width * 0.025,
    color: '#92400e',
    fontWeight: '600',
  },
  cardIcon: {
    width: width * 0.12,
    height: width * 0.12,
    borderRadius: width * 0.06,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: height * 0.015,
    alignSelf: 'center',
  },
  cardEmoji: {
    fontSize: width * 0.06,
  },
  cardName: {
    fontSize: width * 0.04,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
    marginBottom: height * 0.005,
  },
  cardCategory: {
    fontSize: width * 0.03,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: height * 0.01,
  },
  discountContainer: {
    backgroundColor: '#dcfce7',
    borderRadius: 6,
    paddingHorizontal: width * 0.02,
    paddingVertical: height * 0.005,
    alignSelf: 'center',
    marginBottom: height * 0.015,
  },
  discountText: {
    fontSize: width * 0.03,
    color: '#166534',
    fontWeight: '600',
  },
  buyButton: {
    backgroundColor: 'black',
    borderRadius: 8,
    paddingVertical: height * 0.01,
    alignItems: 'center',
  },
  buyButtonText: {
    color: '#ffffff',
    fontSize: width * 0.035,
    fontWeight: '600',
  },
  bottomSpacing: {
    height: height * 0.05,
  },
});


export default GiftCardHomePage;
