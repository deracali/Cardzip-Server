import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import BottomTab from '../../components/tab/tab';

const { width, height } = Dimensions.get('window');

const ProfilePage = () => {
  const [activeTab, setActiveTab] = useState('achievements');
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [recentActivity, setRecentActivity] = useState([]);
  const router = useRouter();

  // User details state
const [userDetails, setUserDetails] = useState({
  fullName: '',
  email: '',
  accountNumber: '',
  bankName: '',
  memberSince: '',
  status: '',
});

useEffect(() => {
  const loadUserDetails = async () => {
    try {
      const email = await AsyncStorage.getItem('email');
      const fullName = await AsyncStorage.getItem('fullName');
      const accountNumber = await AsyncStorage.getItem('accountNumber');
      const bankName = await AsyncStorage.getItem('bankName');
// console.log(email)


      setUserDetails(prev => ({
        ...prev,
        email: email || prev.email,
        fullName: fullName || prev.fullName,
        accountNumber: accountNumber || prev.accountNumber,
        bankName: bankName || prev.bankName,
      }));

      // console.log('✅ Loaded user data:', {
      //   fullName,
      //   email,
      //   accountNumber,
      //   bankName
      // });

    } catch (err) {
      console.error('❌ Error loading user details from AsyncStorage:', err.message);
    }
  };

  loadUserDetails();
}, []);




  // Temporary state for editing
  const [editingDetails, setEditingDetails] = useState({...userDetails});

  // const achievements = [
  //   {
  //     id: 1,
  //     title: 'First Purchase',
  //     description: 'Made your first gift card purchase',
  //     icon: '🎉',
  //     earned: true,
  //     date: '2024-01-15',
  //     color: 'black'
  //   },
  //   {
  //     id: 2,
  //     title: 'Big Spender',
  //     description: 'Spent over $500 on gift cards',
  //     icon: '💰',
  //     earned: true,
  //     date: '2024-02-20',
  //     color: '#10b981'
  //   },
  //   {
  //     id: 3,
  //     title: 'Streak Master',
  //     description: 'Made purchases for 7 consecutive days',
  //     icon: '🔥',
  //     earned: true,
  //     date: '2024-03-10',
  //     color: '#f59e0b'
  //   },
  //   {
  //     id: 4,
  //     title: 'Category Explorer',
  //     description: 'Purchased from 10 different categories',
  //     icon: '🗺️',
  //     earned: false,
  //     progress: 7,
  //     total: 10,
  //     color: '#8b5cf6'
  //   },
  //   {
  //     id: 5,
  //     title: 'Loyalty Member',
  //     description: 'Been a member for over 6 months',
  //     icon: '👑',
  //     earned: true,
  //     date: '2024-04-01',
  //     color: '#f97316'
  //   },
  //   {
  //     id: 6,
  //     title: 'Gift Master',
  //     description: 'Purchased 50 gift cards',
  //     icon: '🎁',
  //     earned: false,
  //     progress: 32,
  //     total: 50,
  //     color: '#ec4899'
  //   }
  // ];

  const [achievements, setAchievements] = useState([]);

useEffect(() => {
  const fetchAchievements = async () => {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (!userId) {
        console.warn('No userId found in AsyncStorage');
        return;
      }
      console.log(userId)

      const res = await axios.get( `https://trader-sr5j-0k7o.onrender.com/api/gift-cards/achievements/${userId}`, {
        params: { userId },
      });
      setAchievements(res.data);
      console.log(achievements)
    } catch (err) {
      console.error('Error fetching achievements:', err.response?.data || err.message);
    }
  };

  fetchAchievements();
}, []);




 const [stats, setStats] = useState([
    { label: 'Total Spent', value: '₦0', icon: '💵' },
    { label: 'Cards Bought', value: '0', icon: '🎯' },
    { label: 'Days Active', value: '0', icon: '📅' },
    { label: 'Achievements', value: '0/6', icon: '🏆' }
  ]);


useEffect(() => {
  const fetchStats = async () => {
    try {
      // console.log('📦 Fetching userId from AsyncStorage...');
      const userId = await AsyncStorage.getItem('userId');
      // console.log('🧾 Raw userId from AsyncStorage:', userId);

      if (!userId) {
        console.warn('⚠️ No userId found in AsyncStorage.');
        return;
      }

      // console.log('📡 Fetching gift cards from server...');
      const res = await axios.get('https://trader-sr5j-0k7o.onrender.com/api/gift-cards/get');

      // console.log('✅ Gift cards response:', res.data);
      const giftCards = res.data?.data || [];

      const userCards = giftCards.filter(
        card => card.user?._id === userId && card.status === 'successful'
      );
      // console.log(`🎯 Filtered userCards (${userCards.length}):`, userCards);

      const totalSpent = userCards.reduce((sum, card) => sum + card.ngnAmount, 0);
      // console.log('💰 Total spent:', totalSpent);

      const totalCards = userCards.length;
      // console.log('🧾 Total cards:', totalCards);

      const dates = userCards.map(card => new Date(card.createdAt));
      const daysActive =
        dates.length > 0
          ? Math.ceil((Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24)) + 1
          : 0;
      // console.log('📅 Days active:', daysActive);

      const achievements = Math.min(6, Math.floor(totalCards / 10));
      // console.log('🏆 Achievements:', achievements);

      setStats([
        { label: 'Total Spent', value: `₦${totalSpent.toLocaleString()}`, icon: '💵' },
        { label: 'Cards Bought', value: `${totalCards}`, icon: '🎯' },
        { label: 'Days Active', value: `${daysActive}`, icon: '📅' },
        { label: 'Achievements', value: `${achievements}/6`, icon: '🏆' }
      ]);
    } catch (err) {
      console.error('❌ Error fetching stats:', err);
    }
  };

  fetchStats();
}, []);




const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);

  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return `${days} days ago`;
};

const fetchGiftCards = async () => {
  try {
    const userId = await AsyncStorage.getItem('userId');

    if (!userId) {
      console.warn('User ID not found in AsyncStorage');
      return;
    }

    const response = await fetch('https://trader-sr5j-0k7o.onrender.com/api/gift-cards/get');
    const json = await response.json();

    // console.log('📦 Full response from /get:', json);

    if (!response.ok) {
      throw new Error(json.message || 'Failed to fetch gift cards');
    }

    const giftCardsArray = Array.isArray(json.data) ? json.data : [];

    if (!Array.isArray(giftCardsArray)) {
      throw new Error('Gift cards data is not an array');
    }

    const statusColors = {
  pending: '#FFA500',      // Orange
  successful: '#28a745',   // Green
  failed: '#dc3545',       // Red
};

const userGiftCards = giftCardsArray
  .filter(card => (card.user?._id === userId) || (card.user === userId))
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .map(card => ({
    action: `${card.type}`,
    amount: `$${card.amount}`,
    date: timeAgo(card.createdAt),
    status: card.status || 'pending',
    statusColor: statusColors[card.status] || statusColors.pending,
  }));


    // console.log('🎯 Filtered User Gift Cards:', userGiftCards);

    setRecentActivity(userGiftCards);
  } catch (err) {
    console.error('❌ Error fetching or filtering gift cards:', err.message);
  }
};


  useEffect(() => {
    fetchGiftCards();
  }, []);


const handleSaveDetails = async () => {
  try {
    const userId = await AsyncStorage.getItem('userId');
    if (!userId) {
      Alert.alert('Error', 'User ID not found.');
      return;
    }

    const payload = {
      name: editingDetails.name || '',
      email: editingDetails.email || '',
      accountNumber: editingDetails.accountNumber || '',
      bankName: editingDetails.bankName || ''
    };

    const response = await axios.put(`https://trader-sr5j-0k7o.onrender.com/api/users/update/${userId}`, payload);

    console.log('✅ User update response:', response.data);

    // Save non-null values only
    if (payload.name) await AsyncStorage.setItem('fullName', payload.name);
    if (payload.email) await AsyncStorage.setItem('email', payload.email);
    if (payload.accountNumber) await AsyncStorage.setItem('accountNumber', payload.accountNumber);
    if (payload.bankName) await AsyncStorage.setItem('bankName', payload.bankName);

    setUserDetails({ ...editingDetails });
    setIsEditModalVisible(false);
    Alert.alert('Success', 'Profile details updated successfully!');
  } catch (error) {
    console.error('❌ Error updating user:', error);
    Alert.alert('Error', 'Failed to update profile. Please try again.');
  }
};



  const handleCancelEdit = () => {
    setEditingDetails({...userDetails});
    setIsEditModalVisible(false);
  };

const handleLogout = () => {
  Alert.alert(
    'Logout',
    'Are you sure you want to logout?',
    [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            // Remove all saved keys
            await AsyncStorage.multiRemove([
              'userId',
              'accountNumber',
              'accountName',
              'bankName',
              'email',
              'fullName',
            ]);
            console.log('✅ User data removed from AsyncStorage');
            // Redirect to login screen
            router.push('/'); // Adjust this path if needed
          } catch (error) {
            console.error('❌ Error during logout:', error.message);
          }
        },
      },
    ]
  );
};


 const [userData, setUserData] = useState(null);

  const fetchUserData = async () => {
    try {
      const userId = await AsyncStorage.getItem('userId'); // Ensure key is lowercase or as saved
      if (!userId) return;

      const response = await axios.get(`https://trader-sr5j-0k7o.onrender.com/api/users/get/${userId}`);
      setUserData(response.data);
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
  };
   const formattedDate = userData
    ? format(new Date(userData.createdAt), 'MMMM d, yyyy')
    : '';


  useEffect(() => {
    fetchUserData();
  }, []);

  if (!userData) return null; // or a loading spinner


const handleOpenEditModal = () => {
  setEditingDetails({
    name: userDetails.fullName || '',
    email: userDetails.email || '',
    accountNumber: userDetails.accountNumber || '',
    bankName: userDetails.bankName || '',
  });
  setIsEditModalVisible(true);
};




  const renderEditModal = () => (
    <Modal
      visible={isEditModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={handleCancelEdit}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Edit Profile</Text>
          <TouchableOpacity onPress={handleSaveDetails}>
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.textInput}
              value={editingDetails.name}
              onChangeText={(text) => setEditingDetails(prev => ({...prev, name: text}))}
              placeholder="Enter your full name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              style={styles.textInput}
              value={editingDetails.email}
              onChangeText={(text) => setEditingDetails(prev => ({...prev, email: text}))}
              placeholder="Enter your email"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Account Number</Text>
            <TextInput
              style={styles.textInput}
              value={editingDetails.accountNumber}
              onChangeText={(text) => setEditingDetails(prev => ({...prev, accountNumber: text}))}
              placeholder="Enter your account number"
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Bank Name</Text>
            <TextInput
              style={styles.textInput}
              value={editingDetails.bankName}
              onChangeText={(text) => setEditingDetails(prev => ({...prev, bankName: text}))}
              placeholder="Enter your bank name"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="black" />
            </TouchableOpacity>

            <View>
              <Text style={styles.headerTitle}>Your Profile</Text>
            </View>

          <TouchableOpacity
  onPress={handleOpenEditModal}
  style={styles.editButton}
>
  <Ionicons name="create-outline" size={20} color="black" />
</TouchableOpacity>

          </View>
        </View>

        {/* Profile Info Card */}
        <View style={styles.profileInfoCard}>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}>
              <Text style={styles.avatarText}>
               {userData.name ? userData.name.split(' ').map(n => n[0]).join('') : ''}
              </Text>
            </View>
            <View style={styles.profileDetails}>
              <Text style={styles.profileName}>{userData.name}</Text>
              <Text style={styles.profileStatus}>{userData.status}</Text>
              <Text style={styles.profileMember}>Member since {formattedDate}</Text>
            </View>
          </View>

          {/* User Details Section */}
          <View style={styles.userDetailsSection}>
            <Text style={styles.sectionTitle}>Account Information</Text>

            <View style={styles.detailRow}>
              <View style={styles.detailIconContainer}>
                <Ionicons name="mail-outline" size={16} color="black" />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Email</Text>
                <Text style={styles.detailValue}>{userDetails.email}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={styles.detailIconContainer}>
                <Ionicons name="card-outline" size={16} color="black" />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Account Number</Text>
                <Text style={styles.detailValue}>{userDetails.accountNumber}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={styles.detailIconContainer}>
                <Ionicons name="business-outline" size={16} color="black" />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Bank Name</Text>
                <Text style={styles.detailValue}>{userDetails.bankName}</Text>
              </View>
            </View>
          </View>

       <View style={styles.levelContainer}>
      <View style={styles.levelHeader}>
        <View>
          <Text style={styles.levelText}>Member Level</Text>
          <Text style={styles.levelValue}>{userData.memberLevel} Member</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.levelText}>Next Level</Text>
          <Text style={[styles.levelValue, { color: 'black' }]}>
            {userData.nextLevel
              ? `${userData.nextLevel} (${userData.progressPercent}%)`
              : 'Max Level'}
          </Text>
        </View>
      </View>
      <View style={styles.progressBar}>
        <View
          style={[styles.progressFill, { width: `${userData.progressPercent}%` }]}
        />
      </View>
    </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsContainer}>
          {stats.map((stat, index) => (
            <View key={index} style={styles.statCard}>
              <Text style={styles.statIcon}>{stat.icon}</Text>
              <Text style={styles.statNumber}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            onPress={() => setActiveTab('achievements')}
            style={[
              styles.tabButton,
              styles.tabButtonLeft,
              activeTab === 'achievements' && styles.tabButtonActive
            ]}
          >
            <Text style={[
              styles.tabText,
              activeTab === 'achievements' && styles.tabTextActive
            ]}>
              Achievements
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('activity')}
            style={[
              styles.tabButton,
              styles.tabButtonRight,
              activeTab === 'activity' && styles.tabButtonActive
            ]}
          >
            <Text style={[
              styles.tabText,
              activeTab === 'activity' && styles.tabTextActive
            ]}>
              Recent Activity
            </Text>
          </TouchableOpacity>
        </View>

        {/* Achievements Tab */}
        {activeTab === 'achievements' && (
          <View>
            <Text style={styles.sectionTitle}>Your Achievements</Text>
            <Text style={styles.sectionSubtitle}>Unlock rewards by completing challenges</Text>

            {achievements.map((achievement) => (
              <View
                key={achievement.id}
                style={[
                  styles.achievementCard,
                  achievement.earned ? styles.achievementEarned : styles.achievementPending
                ]}
              >
                <View style={styles.achievementHeader}>
                  <View style={[
                    styles.achievementIcon,
                    achievement.earned && styles.achievementIconEarned
                  ]}>
                    <Text style={styles.achievementEmoji}>{achievement.icon}</Text>
                  </View>

                  <View style={styles.achievementContent}>
                    <View style={styles.achievementTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.achievementTitle}>{achievement.title}</Text>
                        <Text style={styles.achievementDescription}>{achievement.description}</Text>
                      </View>
                      {achievement.earned && (
                        <View style={styles.achievementBadge}>
                          <Text style={styles.achievementBadgeText}>✓</Text>
                        </View>
                      )}
                    </View>

                   {achievement.earned && achievement.date ? (
  <Text style={styles.achievementDate}>
    Earned on {new Date(achievement.date).toLocaleDateString()}
  </Text>
) : !achievement.earned && (
  <View style={styles.progressContainer}>
    <View style={styles.progressHeader}>
      <Text style={styles.progressText}>Progress</Text>
      <Text style={styles.progressText}>
        {achievement.progress}/{achievement.total}
      </Text>
    </View>
    <View style={styles.progressBarContainer}>
      <View
        style={{
          height: '100%',
          backgroundColor: achievement.color,
          width: `${(achievement.progress / achievement.total) * 100}%`,
          borderRadius: height * 0.004,
        }}
      />
    </View>
  </View>
)}

                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recent Activity Tab */}
        {activeTab === 'activity' && (
          <View>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <Text style={styles.sectionSubtitle}>Your latest purchases and achievements</Text>

        {recentActivity.map((activity, index) => (
  <View key={index} style={styles.activityCard}>
    <View style={styles.activityRow}>
      <View style={styles.activityLeft}>
        <View style={styles.activityIcon}>
          <Text style={styles.activityIconText}>
            {activity.amount ? '🎁' : '⭐'}
          </Text>
        </View>
        <View>
          <Text style={styles.activityAction}>{activity.action}</Text>
          <Text style={styles.activityDate}>{activity.date}</Text>
        </View>
      </View>
      {activity.amount && <Text style={styles.activityAmount}>{activity.amount}</Text>}
      {/* Status badge */}
      <View style={[styles.statusBadge, { backgroundColor: activity.statusColor }]}>
        <Text style={styles.statusText}>{activity.status.toUpperCase()}</Text>
      </View>
    </View>
  </View>
))}

          </View>
        )}

        {/* Logout Button */}
        <View style={styles.logoutContainer}>
          <TouchableOpacity
            onPress={handleLogout}
            style={styles.logoutButton}
          >
            <Ionicons name="log-out-outline" size={20} color="#dc2626" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>

      {renderEditModal()}
      <BottomTab />
    </SafeAreaView>
  );
};

const styles = {
  container: {
    flex: 1,
    backgroundColor: 'white',
    paddingTop: 20,
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
    marginBottom: height * 0.02,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: width * 0.07,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  editButton: {
    width: width * 0.12,
    height: width * 0.12,
    borderRadius: width * 0.06,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  profileInfoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: width * 0.04,
    marginBottom: height * 0.03,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: height * 0.02,
  },
  profileAvatar: {
    width: width * 0.16,
    height: width * 0.16,
    borderRadius: width * 0.08,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: width * 0.04,
  },
  avatarText: {
    fontSize: width * 0.06,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  profileDetails: {
    flex: 1,
  },
  profileName: {
    fontSize: width * 0.05,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  profileStatus: {
    fontSize: width * 0.035,
    color: '#6b7280',
  },
  profileMember: {
    fontSize: width * 0.03,
    color: 'black',
    fontWeight: '600',
  },
  userDetailsSection: {
    marginBottom: height * 0.02,
    paddingTop: height * 0.01,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: height * 0.01,
    marginBottom: height * 0.005,
  },
  detailIconContainer: {
    width: width * 0.08,
    height: width * 0.08,
    borderRadius: width * 0.04,
    backgroundColor: '#f0f9ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: width * 0.03,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: width * 0.03,
    color: '#6b7280',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: width * 0.035,
    fontWeight: '600',
    color: '#1f2937',
  },
  levelContainer: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: width * 0.04,
  },
  levelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: height * 0.015,
  },
  levelText: {
    fontSize: width * 0.03,
    color: '#6b7280',
    marginBottom: height * 0.005,
  },
  levelValue: {
    fontSize: width * 0.035,
    fontWeight: 'bold',
    color: 'black',
  },
  progressBar: {
    backgroundColor: '#e5e7eb',
    height: height * 0.008,
    borderRadius: height * 0.004,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'black',
    width: '87%',
    borderRadius: height * 0.004,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: height * 0.03,
  },
  statCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: width * 0.04,
    alignItems: 'center',
    width: (width - width * 0.15) / 2,
    marginBottom: height * 0.02,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statIcon: {
    fontSize: width * 0.06,
    marginBottom: height * 0.01,
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
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: height * 0.03,
  },
  tabButton: {
    flex: 1,
    paddingVertical: height * 0.015,
    paddingHorizontal: width * 0.04,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  tabButtonLeft: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  tabButtonRight: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderLeftWidth: 0,
  },
  tabButtonActive: {
    backgroundColor: 'black',
    borderColor: 'black',
  },
  tabText: {
    fontSize: width * 0.035,
    fontWeight: '600',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  sectionTitle: {
    fontSize: width * 0.05,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: height * 0.01,
  },
  sectionSubtitle: {
    fontSize: width * 0.035,
    color: '#6b7280',
    marginBottom: height * 0.02,
  },
  achievementCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: width * 0.04,
    marginBottom: height * 0.02,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderLeftWidth: 4,
  },
  achievementEarned: {
    borderLeftColor: '#10b981',
  },
  achievementPending: {
    borderLeftColor: '#e5e7eb',
  },
  achievementHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  achievementIcon: {
    width: width * 0.12,
    height: width * 0.12,
    borderRadius: width * 0.06,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: width * 0.04,
    backgroundColor: '#f3f4f6',
  },
  achievementIconEarned: {
    backgroundColor: '#dcfce7',
  },
  achievementEmoji: {
    fontSize: width * 0.05,
  },
  achievementContent: {
    flex: 1,
  },
  achievementTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: height * 0.01,
  },
  achievementTitle: {
    fontSize: width * 0.04,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  achievementDescription: {
    fontSize: width * 0.035,
    color: '#6b7280',
  },
  achievementBadge: {
    backgroundColor: '#dcfce7',
    borderRadius: width * 0.02,
    padding: width * 0.01,
  },
  achievementBadgeText: {
    fontSize: width * 0.025,
    color: '#166534',
  },
  achievementDate: {
    fontSize: width * 0.03,
    color: '#10b981',
    fontWeight: '600',
  },
  progressContainer: {
    marginTop: height * 0.01,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: height * 0.005,
  },
  progressText: {
    fontSize: width * 0.03,
    color: '#6b7280',
  },
  progressBarContainer: {
    backgroundColor: '#e5e7eb',
    height: height * 0.008,
    borderRadius: height * 0.004,
    overflow: 'hidden',
  },
  activityCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: width * 0.04,
    marginBottom: height * 0.015,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activityIcon: {
    width: width * 0.1,
    height: width * 0.1,
    backgroundColor: '#eef2ff',
    borderRadius: width * 0.05,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: width * 0.03,
  },
  activityIconText: {
    fontSize: width * 0.04,
  },
  activityAction: {
    fontSize: width * 0.035,
    fontWeight: '600',
    color: '#1f2937',
  },
  activityDate: {
    fontSize: width * 0.03,
    color: '#6b7280',
  },
  activityAmount: {
    fontSize: width * 0.035,
    fontWeight: 'bold',
    color: 'black',
  },
  bottomSpacing: {
    height: height * 0.05,
  },
  // Logout styles
  logoutContainer: {
    marginTop: height * 0.03,
    marginBottom: height * 0.02,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: height * 0.018,
    paddingHorizontal: width * 0.04,
    borderWidth: 1.5,
    borderColor: '#fecaca',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  logoutText: {
    fontSize: width * 0.04,
    fontWeight: '600',
    color: '#dc2626',
    marginLeft: width * 0.02,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: width * 0.05,
    paddingVertical: height * 0.02,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: width * 0.045,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  modalCancelText: {
    fontSize: width * 0.04,
    color: '#6b7280',
  },
  modalSaveText: {
    fontSize: width * 0.04,
    color: 'black',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: width * 0.05,
    paddingTop: height * 0.02,
  },
  inputGroup: {
    marginBottom: height * 0.025,
  },
  inputLabel: {
    fontSize: width * 0.035,
    fontWeight: '600',
    color: '#374151',
    marginBottom: height * 0.008,
  },
  textInput: {
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: height * 0.015,
    paddingHorizontal: width * 0.04,
    fontSize: width * 0.04,
    backgroundColor: '#ffffff',
    color: '#1f2937',
  },
    statusBadge: {
    marginLeft: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 80,
  },
  statusText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
};

export default ProfilePage;
