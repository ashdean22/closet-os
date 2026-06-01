import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Alert,
  SafeAreaView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

export default function HomeScreen() {
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const handleAddItem = () => {
    Alert.alert("Add Item", "Choose a source", [
      { text: "Camera", onPress: openCamera },
      { text: "Photo Library", onPress: openLibrary },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const openCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Camera access is needed to take photos."
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const openLibrary = async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Photo library access is needed.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = () => {
    Alert.alert("Coming soon", "Save to Closet upload is not wired up yet.");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6 gap-6">
        <Text className="text-2xl font-bold text-gray-800">My Closet</Text>

        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            className="w-72 h-72 rounded-2xl"
            resizeMode="cover"
          />
        ) : (
          <View className="w-72 h-72 rounded-2xl bg-gray-100 items-center justify-center">
            <Text className="text-gray-400 text-base">No photo selected</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleAddItem}
          className="bg-indigo-600 px-8 py-4 rounded-xl w-full items-center"
        >
          <Text className="text-white text-base font-semibold">Add Item</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSave}
          disabled={!photoUri}
          className={`px-8 py-4 rounded-xl w-full items-center ${
            photoUri ? "bg-emerald-600" : "bg-gray-300"
          }`}
        >
          <Text className="text-white text-base font-semibold">
            Save to Closet
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
