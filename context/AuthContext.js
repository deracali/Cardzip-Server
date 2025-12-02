import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAuthentication = async () => {
            const token = await AsyncStorage.getItem('token');
            setIsAuthenticated(!!token); // Set to true if token exists
            setLoading(false);
        };

        checkAuthentication();
    }, []);

    return (
        <AuthContext.Provider value={{ isAuthenticated, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
