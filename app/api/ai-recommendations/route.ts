import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!)

export async function POST(request: Request) {
  try {
    const { weather, location } = await request.json()

    const prompt = `Given the following weather conditions in ${location.city}, ${location.country}:
    - Temperature: ${weather.temperature}°C (feels like ${weather.feelsLike}°C)
    - Conditions: ${weather.conditions}
    - Wind: ${weather.windSpeed} m/s
    - Humidity: ${weather.humidity}%

    Please provide clothing recommendations in the following format:
    {
      "topWear": [{ "item": "...", "color": "..." }, ...],
      "bottomWear": [{ "item": "...", "color": "..." }, ...],
      "accessories": [{ "item": "...", "color": "..." }, ...],
      "description": "A brief description of the outfit and why it's suitable for the weather"
    }

    Ensure the recommendations are stylish, weather-appropriate, and include color suggestions. Respond ONLY with the JSON object, no additional text.`

    const model = genAI.getGenerativeModel({ model: "gemini-pro" })
    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // Remove any non-JSON content from the beginning and end of the response
    const jsonStart = text.indexOf('{')
    const jsonEnd = text.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('Invalid JSON response from AI model')
    }
    const jsonText = text.slice(jsonStart, jsonEnd + 1)

    // Parse the JSON response
    const recommendations = JSON.parse(jsonText)

    return NextResponse.json(recommendations)
  } catch (error) {
    console.error('Error generating AI recommendations:', error)
    return NextResponse.json({ error: 'Failed to generate AI recommendations' }, { status: 500 })
  }
}