'use client'

import { useState } from 'react'
import WeatherDashboard from './components/WeatherDashboard'
import { NotificationProvider } from './components/NotificationContext'
import Image from 'next/image'

export default function Home() {
  const [showRecommendations, setShowRecommendations] = useState(false)

  return (
    <NotificationProvider>
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/background.jpg')" }}>
        <div className="absolute inset-0 bg-black opacity-20"></div>
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center gap-8">
          {!showRecommendations && (
            <div className="text-center">
              <div className="flex justify-center -mb-16">
                <Image
                  src="/logo_5.svg"
                  alt="Weather Ware Logo"
                  width={350}
                  height={350}
                  className="rounded-full"
                />
              </div>
              <h1 className="text-4xl font-bold text-white mb-2">What To Wear Today?</h1>
              <div className="w-24 h-px bg-white mx-auto mb-2"></div>
              <p className="text-lg text-white/90"> Real-time weather, real-time style </p>
            </div>
          )}
          <WeatherDashboard 
            showRecommendations={showRecommendations}
            setShowRecommendations={setShowRecommendations}
          />
        </div>
      </div>
    </NotificationProvider>
  )
}