import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { WeatherData, ClothingRecommendation } from '@/types'

const API_KEY = process.env.OPENWEATHERMAP_API_KEY
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '')

async function getWeatherData(city: string, country: string): Promise<WeatherData> {
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)},${encodeURIComponent(country)}&appid=${API_KEY}&units=metric`
    )
    
    if (!response.ok) {
      console.error('Weather API Error:', await response.text())
      throw new Error(`Weather API returned ${response.status}`)
    }

    const data = await response.json()
    return {
      temperature: Math.round(data.main.temp),
      conditions: data.weather[0].description,
      windSpeed: Math.round(data.wind.speed),
      humidity: data.main.humidity
    }
  } catch (error) {
    console.error('Error fetching weather data:', error)
    throw new Error('Failed to fetch weather data')
  }
}

async function getAIRecommendations(weather: WeatherData, location: { city: string, country: string }): Promise<ClothingRecommendation> {
  try {
    const prompt = `Given the weather conditions: Temperature ${weather.temperature}°C, ${weather.conditions}, wind speed ${weather.windSpeed} m/s, and humidity ${weather.humidity}% in ${location.city}, ${location.country}, suggest an outfit with specific items and colors for top wear, bottom wear, and accessories. Return only a JSON object with keys "description", "topWear", "bottomWear", and "accessories", where each wear category is an array of objects with "item" and "color" properties. Do not include any markdown formatting or backticks in the response.`

    const model = genAI.getGenerativeModel({ model: "gemini-pro" })
    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()
    
    console.log('Raw AI Response:', text)

    try {
      const aiRecommendations = JSON.parse(text)
      return aiRecommendations
    } catch (error) {
      console.error('Error parsing AI response:', error)
      throw new Error('Invalid AI response format')
    }
  } catch (error) {
    console.error('Error getting AI recommendations:', error)
    throw new Error('Failed to get AI recommendations')
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const city = searchParams.get('city')
    const country = searchParams.get('country')

    if (!city || !country) {
      return NextResponse.json(
        { error: 'City and country are required' },
        { status: 400 }
      )
    }

    const weather = await getWeatherData(city, country)
    const recommendations = await getAIRecommendations(weather, { city, country })

    return NextResponse.json({
      weather,
      recommendations
    })
  } catch (error) {
    console.error('API Route Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch data' },
      { status: 500 }
    )
  }
}