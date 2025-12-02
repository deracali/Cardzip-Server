import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState([]);

  const backendUrl = 'https://morgphealth.onrender.com/';

  // Function to load user profile from AsyncStorage using userId
  const loadUserProfile = async () => {
    try {
      // First, retrieve the userId from AsyncStorage
      const userId = await AsyncStorage.getItem('userId');
      console.log('Retrieved userId from AsyncStorage:', userId);

      if (userId) {
        // If userId exists, fetch user profile from API
        const response = await axios.get(`${backendUrl}api/user/get-profileId/${userId}`);
        if (response.data && response.data.user) {
          const profile = response.data.user;
          setUser(profile); // Set the user profile to state
        }
      } else {
        console.log('No userId found in AsyncStorage');
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    } finally {
      setLoading(false); // Ensure loading is set to false after operation completes
    }
  };

  // Function to fetch doctors data
  const getDoctorsData = async () => {
    try {
      const { data } = await axios.get(`${backendUrl}api/doctor/list`);
      if (data.success) {
        setDoctors(data.doctors);
      } else {
        console.error('Failed to fetch doctors:', data.message);
      }
    } catch (error) {
      console.error('Error fetching doctors data:', error.message);
    }
  };

 // Function to update user profile and store it in AsyncStorage
const updateUserProfile = async (updatedProfile) => {
    try {
      // Make the API call to update the profile on the backend
      const response = await axios.post('https://morgphealth.onrender.com/api/user/update-profileMobile', updatedProfile);
  
      if (response.data && response.data.success) {
        // Update the user profile in context after a successful API call
        setUser(updatedProfile);
  
        // Save the updated profile to AsyncStorage
        await AsyncStorage.setItem('userProfile', JSON.stringify(updatedProfile));
      } else {
        console.error('Failed to update profile:', response.data.message || 'Unknown error');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };
  

  // Load the user profile when the component mounts
  useEffect(() => {
    loadUserProfile();  // Call the function to load the user profile based on userId
  }, []); // Empty dependency array ensures this only runs once

  return (
    <UserContext.Provider
      value={{
        user,
        doctors,
        loading,
        loadUserProfile,
        getDoctorsData,
        updateUserProfile,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
