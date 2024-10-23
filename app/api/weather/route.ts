import { NextResponse } from 'next/server'
import type { WeatherData, ClothingRecommendation } from '@/types'
import { getClothingRecommendations } from '@/app/lib/recommendations'

const WEATHER_API_KEY = process.env.WEATHER_API_KEY
const WEATHER_API_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather'
const AI_API_KEY = process.env.AI_API_KEY
const AI_API_URL = 'https://api.example.com/ai-clothing-recommendations'

async function getAIRecommendations(weatherData: WeatherData): Promise<ClothingRecommendation | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify(weatherData),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error('Failed to get AI recommendations')
    }

    return await response.json()
  } catch (error) {
    console.error('AI API Error:', error)
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')
  const country = searchParams.get('country')

  if (!city || !country) {
    return NextResponse.json({ error: 'Missing city or country' }, { status: 400 })
  }

  try {
    const weatherResponse = await fetch(
      `${WEATHER_API_BASE_URL}?q=${city},${country}&appid=${WEATHER_API_KEY}&units=metric`
    )
    
    if (!weatherResponse.ok) {
      throw new Error('Weather data fetch failed')
    }

    const weatherData = await weatherResponse.json()
    
    const processedWeatherData: WeatherData = {
      temperature: weatherData.main.temp,
      conditions: weatherData.weather[0].main,
      humidity: weatherData.main.humidity,
      windSpeed: weatherData.wind.speed
    }

    let recommendations: ClothingRecommendation
    const aiRecommendations = await getAIRecommendations(processedWeatherData)

    if (aiRecommendations) {
      recommendations = aiRecommendations
    } else {
      // Fallback to our original recommendation function
      recommendations = getClothingRecommendations(processedWeatherData)
    }

    return NextResponse.json({ 
      weather: processedWeatherData, 
      recommendations,
      source: aiRecommendations ? 'AI' : 'Fallback'
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Error fetching data' }, { status: 500 })
  }
}