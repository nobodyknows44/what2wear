import type { WeatherData, ClothingRecommendation, LocationData } from '@/types'

export async function getAIRecommendations(weather: WeatherData, location: LocationData): Promise<ClothingRecommendation> {
  try {
    // Use absolute URL for API endpoint
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    const response = await fetch(`${baseUrl}/api/ai-recommendations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ weather, location }),
    })

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API response not OK:', response.status, errorText);
      throw new Error(`Failed to get AI recommendations: ${response.status} ${errorText}`);
    }

    const aiRecommendations: ClothingRecommendation = await response.json();
    console.log('AI Recommendations from API:', aiRecommendations);
    
    // Validate the response structure
    if (!aiRecommendations.description || !Array.isArray(aiRecommendations.topWear) || 
        !Array.isArray(aiRecommendations.bottomWear) || !Array.isArray(aiRecommendations.accessories)) {
      console.error('Invalid AI response structure:', aiRecommendations);
      throw new Error('Invalid AI response structure');
    }
    
    return aiRecommendations;
  } catch (error) {
    console.error('Error getting AI recommendations:', error);
    // Fallback to a basic recommendation if AI fails
    return getFallbackRecommendations(weather);
  }
}

function getFallbackRecommendations(weather: WeatherData): ClothingRecommendation {
  let topWear = []
  let bottomWear = []
  let accessories = []

  if (weather.temperature < 10) {
    topWear = [
      { item: 'Sweater', color: 'Navy' },
      { item: 'Coat', color: 'Black' },
      { item: 'Thermal Undershirt', color: 'White' }
    ]
    bottomWear = [
      { item: 'Jeans', color: 'Dark Blue' },
      { item: 'Thermal Leggings', color: 'Black' }
    ]
    accessories = [
      { item: 'Scarf', color: 'Gray' },
      { item: 'Gloves', color: 'Black' },
      { item: 'Beanie', color: 'Dark Gray' }
    ]
  } else if (weather.temperature < 20) {
    topWear = [
      { item: 'Light Sweater', color: 'Beige' },
      { item: 'Long-sleeve Shirt', color: 'Light Blue' }
    ]
    bottomWear = [
      { item: 'Chinos', color: 'Khaki' },
      { item: 'Jeans', color: 'Blue' }
    ]
    accessories = [
      { item: 'Light Scarf', color: 'Pastel' },
      { item: 'Ankle Boots', color: 'Brown' }
    ]
  } else {
    topWear = [
      { item: 'T-shirt', color: 'White' },
      { item: 'Light Shirt', color: 'Pastel' }
    ]
    bottomWear = [
      { item: 'Shorts', color: 'Beige' },
      { item: 'Light Pants', color: 'Light Gray' }
    ]
    accessories = [
      { item: 'Sunglasses', color: 'Black' },
      { item: 'Cap', color: 'Navy' },
      { item: 'Sandals', color: 'Brown' }
    ]
  }

  return {
    description: `Based on the current temperature of ${weather.temperature}°C and ${weather.conditions} conditions, here are some clothing recommendations to keep you comfortable and stylish.`,
    topWear,
    bottomWear,
    accessories
  }
}