export interface LocationData {
  city: string;
  country: string;
}

export interface WeatherData {
  temperature: number;
  conditions: string;
  windSpeed: number;
  humidity: number;
}

export interface ClothingItem {
  item: string;
  color: string;
}

export interface ClothingRecommendation {
  topWear: ClothingItem[];
  bottomWear: ClothingItem[];
  accessories: ClothingItem[];
  description: string;
}
