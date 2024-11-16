'use client'

import { useState, useEffect } from 'react'
import WeatherDashboard from './components/WeatherDashboard'
import { NotificationProvider } from './components/NotificationContext'
import Image from 'next/image'

// Type declaration
declare global {
  interface Window {
    UnicornStudio?: {
      init: () => void;
      isInitialized: boolean;
    }
  }
}

export default function Home() {
  const [showRecommendations, setShowRecommendations] = useState(false)

  useEffect(() => {
    // Initialize Unicorn Studio
    if (typeof window !== 'undefined' && !window.UnicornStudio) {
      const initUnicornStudio = () => {
        if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
          window.UnicornStudio.init();
          window.UnicornStudio.isInitialized = true;
          console.log('UnicornStudio initialized');
        }
      };

      window.UnicornStudio = {
        init: initUnicornStudio,
        isInitialized: false
      };

      const script = document.createElement('script');
      script.src = "https://cdn.unicorn.studio/v1.3.2/unicornStudio.umd.js";
      script.onload = initUnicornStudio;
      document.head.appendChild(script);
    }
  }, [])

  return (
    <NotificationProvider>
      <div className="min-h-screen w-full relative bg-gradient-to-b from-blue-300 to-blue-400">
        {/* Unicorn Studio background */}
        <div 
          data-us-project="iUDFQNke6VXPkz6mhwie" 
          className="fixed inset-0 w-full h-full"
        ></div>
        
        {/* Content container */}
        <div className="relative z-10 w-full min-h-screen flex flex-col items-center justify-center px-4 py-8 md:py-0">
          <div className="w-[90%] max-w-7xl flex flex-col items-center justify-center gap-4">
            <div className="text-center space-y-0 w-full">
              <div className="flex justify-center -mb-4 w-full">
              </div>
            </div>
            <div className="w-full">
              <WeatherDashboard 
                showRecommendations={showRecommendations}
                setShowRecommendations={setShowRecommendations}
              />
            </div>
          </div>
        </div>
      </div>
    </NotificationProvider>
  )
}