import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const { width, height } = Dimensions.get('window');
// const API_URL = 'https://trader-sr5j-0k7o.onrender.com/api/gift-cards/get';

const CardSuccessPage = () => {
  const [giftCard, setGiftCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
 const { id } = useLocalSearchParams();



 useEffect(() => {
  let isActive = true;             // guard against state updates after unmount
  const fetchGiftCards = async () => {
    try {
      const res = await fetch('https://trader-sr5j-0k7o.onrender.com/api/gift-cards/get');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      console.log('payload:', payload);

      const allCards = Array.isArray(payload.data) ? payload.data : [];
      const found = allCards.find(card => card._id === id) || null;

      if (isActive) {
        setGiftCard(found);
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      if (isActive) {
        Alert.alert('Error', 'Could not fetch gift card.');
        setLoading(false);
      }
    }
  };

  if (id) {
    // 1) initial fetch
    fetchGiftCards();

    // 2) then poll every 30s
    const intervalId = setInterval(fetchGiftCards, 5_000);

    // cleanup on unmount or id change
    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }
}, [id]);



  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const { status = 'successful', companyFeedback = '' } = giftCard || {};

  // Only icon/title/message vary by status; no more hard-coded descriptions here
  const statusConfig = {
    successful: {
      icon: '✓',
      color: '#10b981',
      bgColor: '#ecfdf5',
      borderColor: '#6ee7b7',
      title: 'Card Request Successful!',
      message: 'Your card is being processed',
    },
    pending: {
      icon: '⏳',
      color: '#f59e0b',
      bgColor: '#fffbeb',
      borderColor: '#fde68a',
      title: 'Card Request Pending',
      message: 'Your card is being processed',
    },
    failed: {
      icon: '✗',
      color: '#ef4444',
      bgColor: '#fef2f2',
      borderColor: '#fecaca',
      title: 'Card Request Failed',
      message: 'Your card processing encountered an issue',
    },
  }[status] || statusConfig.successful;

  const onContinue = () => router.push('/profile/profile');
  const onGoHome   = () => router.push('/home/home');

  return (
    <View style={styles.container}>
      <View style={styles.keyboardView}>
        <View style={styles.scrollContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>💳</Text>
            </View>
            <Text style={styles.appName}>Card Status</Text>
            <Text style={styles.subtitle}>Your card request update</Text>
          </View>

          {/* Status Container */}
          <View style={[
              styles.statusContainer,
              {
                backgroundColor: statusConfig.bgColor,
                borderColor: statusConfig.borderColor
              }
            ]}>
            <View style={[
                styles.statusIconContainer,
                { backgroundColor: statusConfig.color }
              ]}>
              <Text style={styles.statusIcon}>{statusConfig.icon}</Text>
            </View>

            <Text style={[styles.statusTitle, { color: statusConfig.color }]}>
              {statusConfig.title}
            </Text>

            <Text style={styles.processingMessage}>
              {statusConfig.message}
            </Text>

            {/* ALWAYS show companyFeedback here */}
            <Text style={styles.statusDescription}>
              {companyFeedback || 'No additional feedback available.'}
            </Text>
          </View>

          {/* Additional Info */}
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>
              {status === 'successful'
                ? "Your card will be delivered to your registered address within 5-7 business days. Track your delivery status in the app."
                : status === 'pending'
                ? "Please keep this page open while we process your request. This usually takes 2-3 minutes."
                : "If you continue to experience issues, please contact our support team at support@cardapp.com or call +234 800 123 4567."
              }
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {status === 'successful' && (
              <>
                <TouchableOpacity
                  style={styles.authButton}
                  onPress={onContinue}
                >
                  <Text style={styles.authButtonText}>
                    Continue to Dashboard
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.authButton, styles.secondaryButton]}
                  onPress={onGoHome}
                >
                  <Text style={[styles.authButtonText, styles.secondaryButtonText]}>
                    Go to Home
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {status === 'pending' && (
              <TouchableOpacity
                style={[styles.authButton, styles.authButtonDisabled]}
                disabled
              >
                <Text style={styles.authButtonText}>Processing...</Text>
              </TouchableOpacity>
            )}

            {status === 'failed' && (
              <>
                <TouchableOpacity
                  style={styles.authButton}
                  onPress={onContinue}
                >
                  <Text style={styles.authButtonText}>Try Again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.authButton, styles.secondaryButton]}
                  onPress={onGoHome}
                >
                  <Text style={[styles.authButtonText, styles.secondaryButtonText]}>
                    Contact Support
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
};




const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: width * 0.08,
    paddingVertical: height * 0.02,
  },
  header: {
    alignItems: 'center',
    marginTop: height * 0.05,
    marginBottom: height * 0.04,
  },
  logoContainer: {
    width: width * 0.2,
    height: width * 0.2,
    borderRadius: width * 0.1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: height * 0.02,
    shadowColor: 'black',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logoText: {
    fontSize: width * 0.1,
  },
  appName: {
    fontSize: width * 0.08,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: height * 0.01,
  },
  subtitle: {
    fontSize: width * 0.04,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: width * 0.06,
  },
  statusContainer: {
    borderRadius: 16,
    padding: width * 0.06,
    alignItems: 'center',
    marginBottom: height * 0.03,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statusIconContainer: {
    width: width * 0.15,
    height: width * 0.15,
    borderRadius: width * 0.075,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: height * 0.02,
  },
  statusIcon: {
    fontSize: width * 0.08,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  statusTitle: {
    fontSize: width * 0.06,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: height * 0.01,
  },
  processingMessage: {
    fontSize: width * 0.045,
    color: '#374151',
    textAlign: 'center',
    marginBottom: height * 0.015,
    fontWeight: '500',
  },
  statusDescription: {
    fontSize: width * 0.035,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: width * 0.05,
  },
  infoContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: width * 0.04,
    borderLeftWidth: 4,
    borderLeftColor: 'black',
    marginBottom: height * 0.03,
  },
  infoText: {
    fontSize: width * 0.035,
    color: '#6b7280',
    lineHeight: width * 0.05,
  },
  buttonContainer: {
    marginTop: height * 0.02,
  },
  authButton: {
    backgroundColor: 'black',
    height: height * 0.06,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: height * 0.02,
    shadowColor: 'black',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  authButtonDisabled: {
    backgroundColor: '#9ca3af',
    shadowOpacity: 0.1,
  },
  authButtonText: {
    color: '#ffffff',
    fontSize: width * 0.045,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'black',
    shadowOpacity: 0,
    elevation: 0,
  },
  secondaryButtonText: {
    color: 'black',
  },
});

export default CardSuccessPage;
