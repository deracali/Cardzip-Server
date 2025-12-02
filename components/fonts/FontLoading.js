// FontLoading.js
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFonts } from 'expo-font';

const FontLoading = ({ children }) => {
    const [fontsLoaded] = useFonts({
        'Manrope-Regular': require('../../assets/fonts/Manrope-Regular.ttf'),
        'Manrope-Bold': require('../../assets/fonts/Manrope-Bold.ttf'),
    });

    if (!fontsLoaded) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#0000ff" />
            </View>
        );
    }

    return children;
};

export default FontLoading;
