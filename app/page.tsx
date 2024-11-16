'use client'

import { useState, useEffect } from 'react'
import WeatherDashboard from './components/WeatherDashboard'
import { NotificationProvider } from './components/NotificationContext'
import Image from 'next/image'

export default function Home() {
  const [showRecommendations, setShowRecommendations] = useState(false)

  useEffect(() => {
    // Initialize Unicorn Studio
    if (typeof window !== 'undefined' && !window.UnicornStudio) {
      window.UnicornStudio = { 
        isInitialized: false,
        init: () => {
          console.log('UnicornStudio initialized');
          window.UnicornStudio!.isInitialized = true;
        }
      };
      const script = document.createElement('script');
      script.src = "https://cdn.unicorn.studio/v1.3.2/unicornStudio.umd.js";
      script.onload = () => {
        if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
          window.UnicornStudio?.init();
        }
      };
      document.head.appendChild(script);
    }
  }, [])

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative">
      <div 
        data-us-project="iUDFQNke6VXPkz6mhwie" 
        className="absolute inset-0 w-full h-full"
      ></div>
      <div className="absolute inset-0"></div>
      <div className="relative z-10 w-[90%] max-w-7xl flex flex-col items-center justify-center gap-4">
        <div className="text-center space-y-0 w-full">
          <div className="flex justify-center -mb-4 w-full">
          </div>
        </div>
        <div className="pt-5 w-full">
          <WeatherDashboard 
            showRecommendations={showRecommendations}
            setShowRecommendations={setShowRecommendations}
          />
        </div>
      </div>
    </div>
  )
}