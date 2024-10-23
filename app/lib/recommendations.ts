import type { WeatherData, ClothingRecommendation } from '@/types'

export const getClothingRecommendations = (weatherData: WeatherData): ClothingRecommendation => {
  const { temperature, conditions, windSpeed } = weatherData;
  
  const recommendation: ClothingRecommendation = {
    topWear: [],
    bottomWear: [],
    accessories: [],
    description: ''
  };

  // Cold weather (below 10°C/50°F)
  if (temperature < 10) {
    recommendation.topWear = ['Heavy coat', 'Sweater', 'Long-sleeve shirt'];
    recommendation.bottomWear = ['Warm pants', 'Thermal underwear'];
    recommendation.accessories = ['Scarf', 'Gloves', 'Winter hat'];
    recommendation.description = 'Bundle up! It\'s cold outside.';
  }
  // Cool weather (10-18°C/50-65°F)
  else if (temperature < 18) {
    recommendation.topWear = ['Light jacket', 'Long-sleeve shirt'];
    recommendation.bottomWear = ['Jeans', 'Casual pants'];
    recommendation.accessories = ['Light scarf'];
    recommendation.description = 'It\'s cool - layer up!';
  }
  // Mild weather (18-24°C/65-75°F)
  else if (temperature < 24) {
    recommendation.topWear = ['T-shirt', 'Light sweater'];
    recommendation.bottomWear = ['Jeans', 'Casual pants', 'Skirt'];
    recommendation.accessories = [];
    recommendation.description = 'Perfect weather for light layers.';
  }
  // Warm weather (above 24°C/75°F)
  else {
    recommendation.topWear = ['T-shirt', 'Tank top'];
    recommendation.bottomWear = ['Shorts', 'Light pants', 'Skirt'];
    recommendation.accessories = ['Sun hat', 'Sunglasses'];
    recommendation.description = 'Stay cool and protected from the sun!';
  }

  // Add weather-specific items
  if (conditions.toLowerCase().includes('rain')) {
    recommendation.accessories.push('Umbrella', 'Rain jacket');
    recommendation.description += ' Don\'t forget rain protection!';
  }

  if (windSpeed > 20) {
    recommendation.accessories.push('Windbreaker');
    recommendation.description += ' Watch out for strong winds!';
  }

  return recommendation;
};