
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

const GiftCardPurchaseForm = () => {
  // form state
   const router = useRouter();
  const [cardAmount, setCardAmount] = useState('');
  const [cardNumbers, setCardNumbers] = useState(['']);
  const [ngnAmount, setNgnAmount] = useState('0');
  const [cardImages, setCardImages] = useState([]);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
const [userDescription, setUserDescription] = useState('');
const [paymentMethod, setPaymentMethod] = useState('bank'); // default
const [walletAddress, setWalletAddress] = useState('');
const [bankDetails, setBankDetails] = useState({
  bankName: '',
  accountName: '',
  accountNumber: '',
});
const [cryptoRates, setCryptoRates] = useState({});
const [isFetchingRate, setIsFetchingRate] = useState(false);



useEffect(() => {
  const fetchBankDetails = async () => {
    try {
      const bankName = await AsyncStorage.getItem('bankName');
      const accountName = await AsyncStorage.getItem('accountName');
      const accountNumber = await AsyncStorage.getItem('accountNumber');

      setBankDetails({
        bankName: bankName || '',
        accountName: accountName || '',
        accountNumber: accountNumber || '',
      });
    } catch (error) {
      console.error('Error fetching bank details:', error);
    }
  };

  if (paymentMethod === 'bank') {
    fetchBankDetails();
  }
}, [paymentMethod]);




useEffect(() => {
  const fetchCryptoRates = async () => {
    setIsFetchingRate(true);
    try {
      const res = await axios.get('https://trader-sr5j-0k7o.onrender.com/api/crypto-rate/get');
      // Convert to dictionary for easy lookup
      const rates = {};
      res.data.forEach((item) => {
        rates[item.symbol.toUpperCase()] = item.rateInNGN;
      });
      setCryptoRates(rates);
    } catch (err) {
      console.error('Failed to fetch crypto rates:', err.message);
    } finally {
      setIsFetchingRate(false);
    }
  };

  fetchCryptoRates();
}, []);



  // pull in your param
  const { card } = useLocalSearchParams();

  // More robust parsing with error handling
  const parsedCard = (() => {
    try {
      if (typeof card === 'string') {
        return JSON.parse(card);
      } else if (typeof card === 'object' && card !== null) {
        return card;
      }
      return null;
    } catch (error) {
      console.warn('Failed to parse card data:', error);
      return null;
    }
  })();

  // build types, rates, currencies, and optional number-lengths from parsedCard with better error handling
  const availableCardTypes = parsedCard?.types?.map((t) => `${parsedCard.name} (${t.country})`) || [];

  const cardExchangeRates = parsedCard?.types?.reduce((acc, t) => {
    const key = `${parsedCard.name} (${t.country})`;
    acc[key] = parseFloat(t.rate) || 0;
    return acc;
  }, {}) || {};

  const cardCurrencies = parsedCard?.types?.reduce((acc, t) => {
    const key = `${parsedCard.name} (${t.country})`;
    acc[key] = t.currency || 'USD';
    return acc;
  }, {}) || {};


  // single state for which card is selected
  const [selectedCard, setSelectedCard] = useState('');

  // Add state for current currency to ensure proper updates
  const [currentCurrency, setCurrentCurrency] = useState('USD');

  // Initialize selected card when available types change
  useEffect(() => {
    if (availableCardTypes.length > 0 && !selectedCard) {
      const firstCard = availableCardTypes[0];
      setSelectedCard(firstCard);
      setCurrentCurrency(cardCurrencies[firstCard] || 'USD');
    }
  }, [availableCardTypes.length]);

  // Update currency whenever selected card changes
  useEffect(() => {
    if (selectedCard && cardCurrencies[selectedCard]) {
      setCurrentCurrency(cardCurrencies[selectedCard]);
    }
  }, [selectedCard, cardCurrencies]);

  // Get current currency for selected card
  const getCurrentCurrency = () => {
    return currentCurrency;
  };

  // recalc NGN whenever amount or selectedCard changes
  useEffect(() => {
    if (cardAmount && selectedCard && !isNaN(parseFloat(cardAmount))) {
      let val = 0;

      if (paymentMethod === 'usdt') {
        // Convert NGN to USDT
        const ngnValue = parseFloat(cardAmount) * (cardExchangeRates[selectedCard] || 0);
        const usdtRate = cryptoRates['USDT'] || 0;
        if (usdtRate > 0) {
          val = ngnValue / usdtRate;  // ✅ NGN ÷ USDT rate
        }
      } else {
        // Normal NGN calculation
        const rate = cardExchangeRates[selectedCard] || 0;
        val = parseFloat(cardAmount) * rate;
      }

      setNgnAmount(Number.isFinite(val) ? val.toLocaleString() : '0');
    } else {
      setNgnAmount('0');
    }
  }, [cardAmount, selectedCard, cardExchangeRates, paymentMethod, cryptoRates]);


  // format and validate card number
  const formatCardNumber = (txt) =>
    txt
      .replace(/[^A-Za-z0-9]/g, '')
      .replace(/(.{4})/g, '$1 ')
      .trim()
      .toUpperCase();

      const handleCardNumberChange = (txt, index) => {
        const formatted = formatCardNumber(txt);
        const updated = [...cardNumbers];
        updated[index] = formatted;
        setCardNumbers(updated);
      };


      const addCardNumberField = () => {
        setCardNumbers([...cardNumbers, '']);
      };


      const removeCardNumberField = (index) => {
  const updated = cardNumbers.filter((_, i) => i !== index);
  setCardNumbers(updated);
};


const validateCardNumbers = () => {
  return cardNumbers.every(num => num.trim() !== '');
};


  // image pickers
  // const pickImage = async () => {
  //   const result = await ImagePicker.launchImageLibraryAsync({
  //     mediaTypes: ImagePicker.MediaTypeOptions.Images,
  //     allowsEditing: true,
  //     quality: 0.7,
  //   });
  //
  //   if (!result.canceled && result.assets && result.assets[0]) {
  //     setCardImages([...cardImages, result.assets[0]]);
  //   }
  // };
  //
  // const takePhoto = async () => {
  //   const { status } = await ImagePicker.requestCameraPermissionsAsync();
  //   if (status !== 'granted') {
  //     Alert.alert('Permission Denied', 'Camera access is required to take photos.');
  //     return;
  //   }
  //
  //   const result = await ImagePicker.launchCameraAsync({
  //     allowsEditing: true,
  //     quality: 0.7,
  //   });
  //
  //   if (!result.canceled && result.assets && result.assets[0]) {
  //     setCardImages([...cardImages, result.assets[0]]);
  //   }
  // };

  // single unified function to pick or take a photo
  const addImage = async (pickerFunc) => {
    const result = await pickerFunc();
    if (!result.canceled && result.assets && result.assets[0]) {
      setCardImages([...cardImages, result.assets[0]]);
    }
  };

  // gallery picker
  const pickImage = () =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

  // camera picker
  const takePhoto = () =>
    ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.7,
    });

  // show alert to choose source
  const showImageOptions = () =>
    Alert.alert('Add Card Image', 'Choose an option', [
      { text: 'Camera', onPress: () => addImage(takePhoto) },
      { text: 'Gallery', onPress: () => addImage(pickImage) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  // remove image
  const removeImage = (index) => {
    setCardImages(cardImages.filter((_, i) => i !== index));
  };




  // Handle card type selection
  const handleCardTypeSelection = (type) => {
    setSelectedCard(type);
    setCurrentCurrency(cardCurrencies[type] || 'USD');
    setCardNumbers(['']);// Reset card number when type changes
    // Clear related errors
    setErrors(prev => ({
      ...prev,
      card: undefined,
      cardNumber: undefined
    }));
  };

  // Handle amount input
  const handleAmountChange = (text) => {
    // Only allow numbers and decimal point
    const cleanText = text.replace(/[^0-9.]/g, '');
    // Prevent multiple decimal points
    const parts = cleanText.split('.');
    if (parts.length > 2) {
      return;
    }
    setCardAmount(cleanText);
    // Clear amount error when user starts typing
    if (errors.amount) {
      setErrors(prev => ({ ...prev, amount: undefined }));
    }
  };

  // form validation
  const validateForm = () => {
    const errs = {};

    if (!selectedCard) {
      errs.selectedCard = 'Please select a card type';
    }

    if (cardNumbers.length === 0 || cardNumbers.some((num) => !num.trim())) {
      errs.cardNumber = 'Please enter at least one card number';
    } else if (!validateCardNumbers()) {
  errs.cardNumber = `Please enter valid card numbers`;
}

    if (!cardAmount) {
      errs.cardAmount = 'Please enter card amount';
    } else if (isNaN(cardAmount) || parseFloat(cardAmount) <= 0) {
      errs.cardAmount = 'Enter a valid positive amount';
    }

    if (cardImages.length === 0) {
      errs.image = 'Please upload at least one image';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };



// Alternative version without Alert (if you prefer immediate navigation)
const handlePurchase = async () => {
console.log('Button clicked');
  if (!validateForm()) return;

  setIsLoading(true);

  try {
    const storedUserId = await AsyncStorage.getItem('userId');
    if (!storedUserId) {
      throw new Error('User ID not found. Please log in again.');
    }

    const formData = new FormData();

    // Append text fields
    formData.append('type', selectedCard);
    formData.append('amount', cardAmount);
    formData.append('currency', getCurrentCurrency());
    formData.append('ngnAmount', parseFloat(ngnAmount.replace(/,/g, '')));
    formData.append('exchangeRate', cardExchangeRates[selectedCard]);
    formData.append('user', storedUserId);
    formData.append('userDescription', userDescription);
    // Append payment info
formData.append('paymentMethod', paymentMethod);

if (paymentMethod === 'bank') {
  formData.append('bankName', bankDetails.bankName);
  formData.append('accountName', bankDetails.accountName);
  formData.append('accountNumber', bankDetails.accountNumber);
} else if (paymentMethod === 'usdt') {
  if (!walletAddress.trim()) {
    Alert.alert('Error', 'Please enter your USDT wallet address');
    setIsLoading(false);
    return;
  }
  formData.append('walletAddress', walletAddress.trim());
}

    // Append card numbers as array
    formData.append('cardNumbers', JSON.stringify(cardNumbers));


    // Append images as array
    if (cardImages.length > 0) {
    cardImages.forEach((img) => {
      const fileUri = img.uri;
      const fileName = img.fileName || fileUri.split("/").pop();
      const fileType = img.type || "image/jpeg";

      formData.append("images", {
        uri: fileUri,
        name: fileName,
        type: fileType,
      });
    });
  } else {
    throw new Error("At least one image is required.");
  }



    // Send to server
    const response = await axios.post(
      'https://trader-sr5j-0k7o.onrender.com/api/gift-cards/create',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    const createdCardId = response?.data?.giftCard?._id;

    if (!createdCardId) {
      console.error('No card ID found in response:', response.data);
      throw new Error('Card created but ID not found in response');
    }

    // Reset form
    setCardAmount('');
    setCardNumbers(['']);  // reset to one empty input
    setCardImages([]);     // reset to no images
    setNgnAmount('0');
    setErrors({});

    if (availableCardTypes.length > 0) {
      const firstCard = availableCardTypes[0];
      setSelectedCard(firstCard);
      setCurrentCurrency(cardCurrencies[firstCard] || 'USD');
    }

    // Navigate directly to success screen
    router.push({
      pathname: '/success/successScreen',
      params: {
        id: createdCardId,
        amount: ngnAmount,
        cardType: selectedCard,
        cardAmount: cardAmount,
        currency: getCurrentCurrency()
      },
    });

  } catch (error) {
    console.error('Gift card purchase error:', error.response?.data || error.message);

    let errorMessage = 'Failed to process purchase. Please try again.';

    if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    Alert.alert('Error', errorMessage);
  } finally {
    setIsLoading(false);
  }
};

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <ScrollView
        style={styles.keyboardView}
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="black" />
      </TouchableOpacity>
      <View style={styles.logoContainer}>
        <Text style={styles.logoText}>💳</Text>
      </View>
      <Text style={styles.appName}>GiftCard Exchange</Text>
      <Text style={styles.subtitle}>
        Sell your gift cards instantly{'\n'}Get paid in Nigerian Naira
      </Text>
    </View>

        {/* Form Container */}
        <View style={styles.formContainer}>
          {/* Gift Card Type Selection */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Select Gift Card Type *</Text>
            {availableCardTypes.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.cardTypeContainer}>
                  {availableCardTypes.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.cardTypeButton,
                        selectedCard === type && styles.cardTypeButtonActive,
                      ]}
                      onPress={() => handleCardTypeSelection(type)}
                    >
                      <Text
                        style={[
                          styles.cardTypeText,
                          selectedCard === type && styles.cardTypeTextActive,
                        ]}
                      >
                        {type}
                      </Text>
                      <Text style={styles.rateText}>
                        ₦{cardExchangeRates[type]}/{cardCurrencies[type] || 'USD'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <View style={styles.noCardTypesContainer}>
                <Text style={styles.noCardTypesText}>
                  No card types available. Please check your card data.
                </Text>
              </View>
            )}
            {errors.card && <Text style={styles.errorText}>{errors.card}</Text>}
          </View>

          {/* Card Amount Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Card Amount ({getCurrentCurrency()}) *</Text>
            <TextInput
              style={[styles.input, errors.amount && styles.inputError]}
              value={cardAmount}
              onChangeText={handleAmountChange}
              placeholder={`Enter amount in ${getCurrentCurrency()}`}
              keyboardType="numeric"
              placeholderTextColor="#9ca3af"
            />
            {errors.amount && <Text style={styles.errorText}>{errors.amount}</Text>}
          </View>

          {/* Card Number Input */}
          <View style={styles.inputContainer}>
    <Text style={styles.label}>
      Card Numbers *
    </Text>

    {cardNumbers.map((num, index) => (
      <View key={index} style={{ marginBottom: 8 }}>
        <TextInput
          style={[styles.input, errors.cardNumber && styles.inputError]}
          value={num}
          onChangeText={(txt) => handleCardNumberChange(txt, index)}
          placeholder={
            selectedCard
              ? `Enter ${selectedCard} number ${index + 1}`
              : 'Select card type first'
          }
          keyboardType="default"
          placeholderTextColor="#9ca3af"
          autoCapitalize="characters"
          editable={!!selectedCard}
        />

        {/* Remove button (only for extra fields) */}
        {index > 0 && (
          <TouchableOpacity onPress={() => removeCardNumberField(index)}>
            <Text style={{ color: 'red', fontSize: 12 }}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
    ))}

    {/* Add another number */}
    <TouchableOpacity onPress={addCardNumberField}>
      <Text style={{ color: 'blue', marginTop: 5 }}>+ Add another card number</Text>
    </TouchableOpacity>

    {errors.cardNumber && <Text style={styles.errorText}>{errors.cardNumber}</Text>}
  </View>



          {/* User Description Input */}
<View style={styles.inputContainer}>
  <Text style={styles.label}>Description (optional)</Text>
  <TextInput
    style={styles.input}
    value={userDescription}
    onChangeText={setUserDescription}
    placeholder="Describe the card, e.g. unused, with receipt..."
    placeholderTextColor="#9ca3af"
    multiline
    numberOfLines={3}
  />
</View>





<View style={styles.inputContainer}>
<Text style={styles.label}>Payment Method *</Text>
<View style={{ flexDirection: 'row', marginTop: 8 }}>
{['bank', 'usdt'].map((method) => (
<TouchableOpacity
  key={method}
  style={[
    styles.paymentButton,
    paymentMethod === method && styles.paymentButtonActive,
  ]}
  onPress={() => setPaymentMethod(method)}
>
  <Text
    style={[
      styles.paymentText,
      paymentMethod === method && styles.paymentTextActive,
    ]}
  >
    {method.toUpperCase()}
  </Text>
</TouchableOpacity>
))}
</View>
</View>


{paymentMethod === 'bank' ? (
<View style={styles.inputContainer}>
<Text style={styles.label}>Bank Details</Text>
<Text style={styles.infoText}>
Bank: {bankDetails.bankName}{"\n"}
Account Name: {bankDetails.accountName}{"\n"}
Account Number: {bankDetails.accountNumber}
</Text>
</View>
) : (
<View style={styles.inputContainer}>
<Text style={styles.label}>USDT Wallet Address *</Text>
<TextInput
style={styles.input}
value={walletAddress}
onChangeText={setWalletAddress}
placeholder="Enter USDT wallet address"
placeholderTextColor="#9ca3af"
autoCapitalize="none"
/>
</View>
)}




          {/* Card Image Upload */}
          <View style={styles.inputContainer}>
      <Text style={styles.label}>Card Images *</Text>
      <Text style={styles.imageNote}>
        Upload clear photos of your gift card (front / back if required)
      </Text>

      <View style={styles.imageList}>
        {cardImages.map((img, index) => (
          <View key={index} style={styles.imagePreviewContainer}>
            <Image source={{ uri: img.uri }} style={styles.imagePreview} />
            <TouchableOpacity
              style={styles.removeImageButton}
              onPress={() => removeImage(index)}
            >
              <Text style={styles.removeImageText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>




      {/* Add button (always available) */}
      <TouchableOpacity
        style={[
          styles.imageUploadButton,
          errors.image && styles.imageUploadButtonError,
        ]}
        onPress={showImageOptions}
      >
        <Text style={styles.imageUploadIcon}>📷</Text>
        <Text style={styles.imageUploadText}>Tap to add another image</Text>
        <Text style={styles.imageUploadSubtext}>Camera or Gallery</Text>
      </TouchableOpacity>

      {errors.image && <Text style={styles.errorText}>{errors.image}</Text>}
    </View>


          {/* NGN Amount Display */}
          <View style={styles.conversionContainer}>
            <View style={styles.conversionHeader}>
              <Text style={styles.conversionLabel}>You will receive:</Text>
              <Text style={styles.amountText}>
    {paymentMethod === 'usdt'
      ? `${ngnAmount} USDT`
      : `₦${ngnAmount}`}
  </Text>

            </View>
            {selectedCard && cardAmount && (
    <Text style={styles.conversionRate}>
      {paymentMethod === 'usdt'
        ? `Rate: ${cryptoRates['USDT']?.toLocaleString() || '...'} NGN = 1 USDT`
        : `Rate: ₦${cardExchangeRates[selectedCard]} per ${getCurrentCurrency()}`}
    </Text>
  )}



          </View>

          {/* Purchase Button */}
          <TouchableOpacity
            style={[styles.authButton, isLoading && styles.authButtonDisabled]}
            onPress={handlePurchase}
            disabled={isLoading}
          >
            <Text style={styles.authButtonText}>
              {isLoading ? 'Processing...' : 'Sell Gift Card'}
            </Text>
          </TouchableOpacity>

          {/* Info Text */}
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>
              • Instant payment after verification{'\n'}
              • Secure and trusted platform{'\n'}
              • 24/7 customer support{'\n'}
              • Clear card images ensure faster processing
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
    backButton: {
  position: 'absolute',
  left: 10,
  top: 10,
  zIndex: 1,
  padding: 10,
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
    labelNote: {
        fontSize: width * 0.03,
        fontWeight: '400',
        color: '#6b7280',
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
    inputError: {
        borderColor: '#ef4444',
        backgroundColor: '#fef2f2',
    },
    cardTypeContainer: {
        flexDirection: 'row',
        paddingVertical: height * 0.01,
    },
    cardTypeButton: {
        paddingHorizontal: width * 0.04,
        paddingVertical: height * 0.015,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#e5e7eb',
        backgroundColor: '#f9fafb',
        marginRight: width * 0.03,
        alignItems: 'center',
        minWidth: width * 0.25,
    },
    cardTypeButtonActive: {
        borderColor: 'black',
        backgroundColor: '#eef2ff',
    },
    cardTypeText: {
        fontSize: width * 0.035,
        color: '#6b7280',
        fontWeight: '500',
        marginBottom: 2,
    },
    cardTypeTextActive: {
        color: 'black',
        fontWeight: '600',
    },
    rateText: {
        fontSize: width * 0.03,
        color: '#9ca3af',
    },
    imageNote: {
        fontSize: width * 0.032,
        color: '#6b7280',
        marginBottom: height * 0.01,
        fontStyle: 'italic',
    },
    imageUploadButton: {
        height: height * 0.12,
        borderWidth: 2,
        borderColor: '#e5e7eb',
        borderStyle: 'dashed',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
    },
    imageUploadButtonError: {
        borderColor: '#ef4444',
        backgroundColor: '#fef2f2',
    },
    imageUploadIcon: {
        fontSize: width * 0.08,
        marginBottom: height * 0.005,
    },
    imageUploadText: {
        fontSize: width * 0.04,
        color: '#374151',
        fontWeight: '500',
    },
    imageUploadSubtext: {
        fontSize: width * 0.032,
        color: '#6b7280',
        marginTop: 2,
    },
    imagePreviewContainer: {
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
    },
    imagePreview: {
        width: '100%',
        height: height * 0.2,
        borderRadius: 12,
        resizeMode: 'cover',
    },
    removeImageButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    removeImageText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    conversionContainer: {
        backgroundColor: '#f0f9ff',
        borderRadius: 12,
        padding: width * 0.04,
        marginBottom: height * 0.025,
        borderWidth: 1,
        borderColor: '#bae6fd',
    },
    conversionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: height * 0.005,
    },
    conversionLabel: {
        fontSize: width * 0.04,
        color: '#0369a1',
        fontWeight: '500',
    },
    ngnAmount: {
        fontSize: width * 0.05,
        fontWeight: 'bold',
        color: '#0c4a6e',
    },
    conversionRate: {
        fontSize: width * 0.032,
        color: '#0284c7',
        textAlign: 'center',
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
    authButtonDisabled: {
        backgroundColor: '#9ca3af',
        shadowOpacity: 0.1,
    },
    authButtonText: {
        color: '#ffffff',
        fontSize: width * 0.045,
        fontWeight: '600',
    },
    infoContainer: {
        backgroundColor: '#f9fafb',
        borderRadius: 8,
        padding: width * 0.04,
        borderLeftWidth: 4,
        borderLeftColor: 'black',
    },
    infoText: {
        fontSize: width * 0.035,
        color: '#6b7280',
        lineHeight: width * 0.05,
    },
    errorText: {
        color: '#ef4444',
        fontSize: width * 0.032,
        marginTop: height * 0.005,
        fontWeight: '500',
    },
    paymentButton: {
  flex: 1,
  paddingVertical: 10,
  borderWidth: 1.5,
  borderColor: '#e5e7eb',
  borderRadius: 12,
  alignItems: 'center',
  marginRight: 10,
  backgroundColor: '#f9fafb',
},
paymentButtonActive: {
  borderColor: 'black',
  backgroundColor: '#eef2ff',
},
paymentText: {
  fontSize: width * 0.035,
  color: '#6b7280',
  fontWeight: '500',
},
paymentTextActive: {
  color: 'black',
  fontWeight: '600',
},

});

export default GiftCardPurchaseForm;
