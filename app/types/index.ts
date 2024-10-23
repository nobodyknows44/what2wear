// types/index.ts
export interface LocationData {
    city: string;
    country: string;
  }
  
  export interface WeatherData {
    temperature: number;
    conditions: string;
    humidity: number;
    windSpeed: number;
  }
  
  export interface ClothingRecommendation {
    topWear: string[];
    bottomWear: string[];
    accessories: string[];
    description: string;
  }
  