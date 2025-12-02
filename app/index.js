import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    Alert,
    Dimensions,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

const BASE_URL = 'https://trader-sr5j-0k7o.onrender.com/api/users';

const GiftCardAuth = () => {
  const router = useRouter();

 const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    accountNumber: '',
    accountName: '',
    bankName: '',
  });


  useEffect(() => {
    const checkUser = async () => {
      const userId = await AsyncStorage.getItem('userId');
      if (userId) {
        router.replace('/home/home');
      }
    };
    checkUser();
  }, []);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };


const handleAuth = async () => {
  if (isSignUp) {
    if (formData.password !== formData.confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (!formData.fullName.trim()) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }
  }

  if (!formData.email.trim() || !formData.password.trim()) {
    Alert.alert('Error', 'Please fill in all required fields');
    return;
  }

  try {
    setLoading(true);

    const endpoint = isSignUp
      ? `https://trader-sr5j-0k7o.onrender.com/api/users/signup`
      : `https://trader-sr5j-0k7o.onrender.com/api/users/login`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isSignUp
          ? {
              name: formData.fullName,
              email: formData.email,
              password: formData.password,
              accountNumber: formData.accountNumber,
              accountName: formData.accountName,
              bankName: formData.bankName,
            }
          : {
              email: formData.email,
              password: formData.password,
            }
      ),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Authentication failed');
    }

    // ✅ Save details to AsyncStorage
   if (data.user && data.user.id) {
  await AsyncStorage.setItem('userId', data.user.id);

  if (data.user.accountNumber)
    await AsyncStorage.setItem('accountNumber', data.user.accountNumber);
  if (data.user.accountName)
    await AsyncStorage.setItem('accountName', data.user.accountName);
  if (data.user.bankName)
    await AsyncStorage.setItem('bankName', data.user.bankName);
  if (data.user.email)
    await AsyncStorage.setItem('email', data.user.email);
  if (data.user.name)
    await AsyncStorage.setItem('fullName', data.user.name);


   if (data.user.createdAt) {
    const createdDate = new Date(data.user.createdAt);
    const formattedDate = createdDate.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    await AsyncStorage.setItem('createdAt', formattedDate);
  }
  console.log('✅ User data saved to AsyncStorage');
}


    Alert.alert(
      'Success',
      `${isSignUp ? 'Account created' : 'Signed in'} successfully!`,
      [
        {
          text: 'OK',
          onPress: () => {
            router.replace('/home/home');
          },
        },
      ]
    );
  } catch (error) {
    Alert.alert('Error', error.message);
    console.error('❌ Auth error:', error.message);
  } finally {
    setLoading(false);
  }
};


  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setFormData({
      email: '',
      password: '',
      confirmPassword: '',
      fullName: '',
      accountNumber: '',
      accountName: '',
      bankName: '',
    });
  };


  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>🎁</Text>
            </View>
            <Text style={styles.appName}>GiftCard</Text>
            <Text style={styles.subtitle}>
              {isSignUp
                ? 'Create your account to start gifting'
                : 'Welcome back! Sign in to continue'}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formContainer}>
            {isSignUp && (
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your full name"
                  placeholderTextColor="#999"
                  value={formData.fullName}
                  onChangeText={value => handleInputChange('fullName', value)}
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#999"
                value={formData.email}
                onChangeText={value => handleInputChange('email', value)}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#999"
                value={formData.password}
                onChangeText={value => handleInputChange('password', value)}
                secureTextEntry
              />
            </View>

            {isSignUp && (
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Confirm your password"
                  placeholderTextColor="#999"
                  value={formData.confirmPassword}
                  onChangeText={value => handleInputChange('confirmPassword', value)}
                  secureTextEntry
                />
              </View>
            )}

            {isSignUp && (
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Account Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter account number"
                    placeholderTextColor="#999"
                    value={formData.accountNumber}
                    onChangeText={value => handleInputChange('accountNumber', value)}
                    keyboardType="number-pad"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Account Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter account name"
                    placeholderTextColor="#999"
                    value={formData.accountName}
                    onChangeText={value => handleInputChange('accountName', value)}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Bank Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter bank name"
                    placeholderTextColor="#999"
                    value={formData.bankName}
                    onChangeText={value => handleInputChange('bankName', value)}
                    autoCapitalize="words"
                  />
                </View>
              </>
            )}
<View style={styles.rememberMeContainer}>
  <TouchableOpacity
    onPress={() => setRememberMe(!rememberMe)}
    style={styles.checkboxRow}
  >
    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]} />
    <Text style={styles.rememberMeText}>Remember Me</Text>
  </TouchableOpacity>
</View>

            {!isSignUp && (
              <TouchableOpacity style={styles.forgotPassword}>
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.authButton, loading && { opacity: 0.7 }]}
              onPress={handleAuth}
              disabled={loading}
            >
              <Text style={styles.authButtonText}>
                {loading
                  ? isSignUp
                    ? 'Signing Up...'
                    : 'Logging In...'
                  : isSignUp
                  ? 'Create Account'
                  : 'Sign In'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Toggle Mode */}
          <View style={styles.toggleContainer}>
            <Text style={styles.toggleText}>
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            </Text>
            <TouchableOpacity onPress={toggleMode}>
              <Text style={styles.toggleButton}>{isSignUp ? 'Sign In' : 'Sign Up'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
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
  formContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: width * 0.06,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: height * 0.03,
  },
  inputContainer: {
    marginBottom: height * 0.025,
  },
  label: {
    fontSize: width * 0.035,
    fontWeight: '600',
    color: '#374151',
    marginBottom: height * 0.01,
  },
  input: {
    height: height * 0.06,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: width * 0.04,
    fontSize: width * 0.04,
    color: '#1f2937',
    backgroundColor: '#f9fafb',
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: height * 0.03,
  },
  forgotPasswordText: {
    color: 'black',
    fontSize: width * 0.035,
    fontWeight: '500',
  },
  authButton: {
    backgroundColor: 'black',
    height: height * 0.06,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: height * 0.03,
    shadowColor: 'black',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  authButtonText: {
    color: '#ffffff',
    fontSize: width * 0.045,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: height * 0.025,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  dividerText: {
    marginHorizontal: width * 0.04,
    color: '#9ca3af',
    fontSize: width * 0.035,
  },
  socialButton: {
    height: height * 0.06,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: height * 0.015,
    backgroundColor: '#ffffff',
  },
  socialButtonText: {
    color: '#374151',
    fontSize: width * 0.04,
    fontWeight: '500',
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: height * 0.02,
  },
  toggleText: {
    color: '#6b7280',
    fontSize: width * 0.04,
  },
  toggleButton: {
    color: 'black',
    fontSize: width * 0.04,
    fontWeight: '600',
  },
  rememberMeContainer: {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: 16,
},

checkboxRow: {
  flexDirection: 'row',
  alignItems: 'center',
},

checkbox: {
  width: 20,
  height: 20,
  borderWidth: 1,
  borderColor: '#ccc',
  borderRadius: 4,
  marginRight: 8,
},

checkboxChecked: {
  backgroundColor: '#007bff',
},

rememberMeText: {
  fontSize: 14,
  color: '#555',
},

});

export default GiftCardAuth;
