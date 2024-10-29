import { NextResponse } from 'next/server'
import type { WeatherData, LocationData } from '@/types'

const API_KEY = process.env.OPENWEATHERMAP_API_KEY

async function getWeatherData(city: string, country: string): Promise<WeatherData> {
  const response = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${city},${country}&appid=${API_KEY}&units=metric`
  )
  if (!response.ok) {
    throw new Error('Failed to fetch weather data')
  }
  const data = await response.json()
  return {
    temperature: Math.round(data.main.temp),
    conditions: data.weather[0].description,
    windSpeed: data.wind.speed,
    humidity: data.main.humidity,
  }
}

async function getAIRecommendations(weather: WeatherData, location: LocationData) {
  try {
    const response = await fetch('http://localhost:3000/api/ai-recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ weather, location }),
    })
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
    return NextResponse.json({ error: 'City and country are required' }, { status: 400 })
  }

  try {
    const weatherData = await getWeatherData(city, country)
    const recommendations = await getAIRecommendations(weatherData, { city, country })

    return NextResponse.json({
      weather: weatherData,
      recommendations: recommendations || null,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}