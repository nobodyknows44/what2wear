import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { WeatherData, ClothingRecommendation, LocationData } from '@/types';

// Initialize the Google AI client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

export async function POST(request: Request) {
  try {
    const { weather, location }: { weather: WeatherData; location: LocationData } = await request.json();

    const prompt = `Given the weather conditions: Temperature ${weather.temperature}°C, ${weather.conditions}, wind speed ${weather.windSpeed} m/s, and humidity ${weather.humidity}% in ${location.city}, ${location.country}, suggest an outfit with specific items and colors for top wear, bottom wear, and accessories. Return only a JSON object with keys "description", "topWear", "bottomWear", and "accessories", where each wear category is an array of objects with "item" and "color" properties. Do not include any markdown formatting or backticks in the response.`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    console.log('Raw AI Response:', text);

    // Clean the response text to remove any markdown formatting
    const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
    
    let aiRecommendations: ClothingRecommendation;
    try {
      aiRecommendations = JSON.parse(cleanedText);
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new Error('Invalid AI response format');
    }

    return NextResponse.json(aiRecommendations);
  } catch (error) {
    console.error('Error in AI recommendations:', error);
    return NextResponse.json({ error: 'Failed to get AI recommendations' }, { status: 500 });
  }
}